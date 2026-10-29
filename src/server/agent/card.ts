import { z } from "zod";
import type { EditionItem, GuardrailResult, StaffCard } from "@/contract";
import { newToken } from "@/lib/ids";
import { createLogger } from "../log";
import { HttpError, UpstreamError } from "../http/errors";
import { voiceSystem } from "./copy";
import { guardField, mergeResults } from "./guard";
import { askJson } from "./json";
import { COPY_MODEL, limitsOf, type AgentDeps, type StoreContext } from "./ports";
import { loadEditionAccess } from "./workspace";

const log = createLogger("agent:card");

type Line = { heading: string; body: string };

const CardLines = z.object({
  lines: z.array(z.object({ heading: z.string().min(2).max(40), body: z.string().min(5).max(240) })).min(2).max(6),
});

/** Plain card used when the copy model is unavailable. Built only from the items' own (guarded) text. */
function templateLines(items: EditionItem[]): Line[] {
  const lines: Line[] = [];
  for (const i of items) {
    if (i.kind === "special") lines.push({ heading: "This week's special", body: `${i.name}. ${i.staffLine}` });
    if (i.kind === "sound") lines.push({ heading: "On the speakers", body: i.brief });
    if (i.kind === "partner") lines.push({ heading: "Next door", body: `${i.place.name}. ${i.reason} ${i.offerIdea}` });
    if (i.kind === "event") lines.push({ heading: "Event night", body: `${i.title}, ${i.day} at ${i.time}. ${i.description}` });
  }
  return lines;
}

function itemFacts(items: EditionItem[]): string {
  return templateLines(items).map((l) => `${l.heading}: ${l.body}`).join("\n");
}

async function writeLines(deps: AgentDeps, sc: StoreContext, items: EditionItem[]): Promise<Line[]> {
  try {
    const user = `Write a one-page staff card for the team at ${sc.store.name} for the week of ${sc.weekOf}. Use only these approved items and keep each line something a barista can say out loud.\n${itemFacts(items)}\nReply as JSON: {"lines": [{"heading": "<=40 chars", "body": "<=240 chars"}]} with 3 to 5 lines.`;
    const out = await askJson(deps.chat, { model: COPY_MODEL, system: voiceSystem(sc), user, schema: CardLines, maxTokens: 700, timeoutMs: limitsOf(deps).chatTimeoutMs });
    return out.lines;
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
    log.warn("card copy failed, using template", { err: e });
    return templateLines(items);
  }
}

/**
 * The staff card for an edition, generated on first request and then stored. Lines are written by
 * the copy model from the edition's usable items, then every line passes guardrails; a blocked
 * line is left off the card rather than shown.
 */
export async function getOrCreateCard(deps: AgentDeps, workspaceId: string, editionId: string): Promise<StaffCard> {
  const { repo } = deps;
  const { edition, store, chain } = await loadEditionAccess(repo, workspaceId, editionId);
  if (edition.status === "drafting") throw new HttpError(409, "edition_drafting", "This edition is still being built.");
  const existing = await repo.getStaffCardByEdition(editionId);
  if (existing && existing.lines.length) return existing;

  const items = edition.items.filter((i) => i.status !== "rejected" && i.status !== "flagged");
  if (!items.length) throw new HttpError(409, "edition_not_ready", "This edition has no usable items yet, so there is no card to write.");

  const sc: StoreContext = { chain, store, menu: [], weekOf: edition.weekOf };
  const drafted = await writeLines(deps, sc, items);
  const checked = await Promise.all(
    drafted.map(async (l) => {
      const [h, b] = await Promise.all([guardField(deps, sc, "card", "heading", l.heading), guardField(deps, sc, "card", "body", l.body)]);
      return { line: { heading: h.text, body: b.text } as Line, results: [h.result, b.result] };
    }),
  );
  const usable = checked.filter((c) => c.results.every((r) => r.status !== "blocked"));
  const removed = checked.length - usable.length;
  const merged: GuardrailResult = mergeResults(usable.flatMap((c) => c.results.map((result) => ({ field: "line", result }))));
  const guardrail: GuardrailResult = removed ? { ...merged, reasons: [...merged.reasons, `${removed} line(s) were left off because guardrails blocked them.`] } : merged;

  if (!usable.length) throw new HttpError(422, "card_blocked", "Guardrails blocked every line of the card.");
  const card: StaffCard = {
    editionId,
    storeId: store.id,
    token: existing?.token ?? newToken(),
    lines: usable.map((c) => c.line),
    guardrail,
  };
  // A blanked card keeps its share token. A first card is set-if-absent: of two requests racing to write
  // it, one wins and the other returns the winner's card, so a token already handed out never dies.
  return existing ? repo.putStaffCard(card) : repo.putStaffCardIfAbsent(card);
}
