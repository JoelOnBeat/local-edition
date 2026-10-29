import type { AgentEvent, EditionItem } from "@/contract";
import { newId } from "@/lib/ids";
import { createLogger } from "../log";
import { HttpError, UpstreamError } from "../http/errors";
import { NotFoundError, VersionConflictError } from "../store/repo";
import { invalidateCard } from "./card-state";
import { evidenceCheck, produceItem } from "./items";
import { runStoreAgent } from "./loop";
import type { Exclusions } from "./plan";
import type { AgentDeps } from "./ports";
import { loadEditionAccess } from "./workspace";

const log = createLogger("agent:regenerate");

export interface RegenerateParams {
  workspaceId: string;
  editionId: string;
  itemId: string;
  hint?: string;
}

function exclusionsFor(item: EditionItem): Exclusions {
  switch (item.kind) {
    case "special": return { menuItemIds: [item.baseMenuItemId] };
    case "partner": return { placeIds: [item.place.entityId] };
    case "event": return { eventUrls: item.tieIn ? [item.tieIn.url] : [] };
    case "sound": return { artistIds: item.artists.map((a) => a.entityId) };
  }
}

const err = (code: string, message: string, storeId?: string): AgentEvent => ({ type: "error", ...(storeId ? { storeId } : {}), code, message });

/**
 * Rewrite one item after head office asks for another take. The agent runs again for that kind
 * only, avoiding what the item says now; the item keeps its id and the repo bumps its version.
 */
export async function* regenerateItem(params: RegenerateParams, deps: AgentDeps): AsyncGenerator<AgentEvent> {
  const { repo } = deps;
  let access;
  try {
    access = await loadEditionAccess(repo, params.workspaceId, params.editionId);
  } catch (e) {
    if (e instanceof HttpError) { yield err(e.code, e.message); return; }
    throw e;
  }
  const { edition, store, chain } = access;
  const current = edition.items.find((i) => i.id === params.itemId);
  if (!current) {
    yield err("item_not_found", "That item does not exist in this edition.", store.id);
    return;
  }
  const menu = await repo.listMenu(chain.id);
  const sc = { chain, store, menu, weekOf: edition.weekOf };
  const runId = newId("run");
  yield { type: "run_started", runId, storeIds: [store.id] };
  yield { type: "store_started", storeId: store.id };

  try {
    const { set, mem } = yield* runStoreAgent({ sc, deps, focus: current.kind, hint: params.hint, exclude: exclusionsFor(current) });
    const { kept } = evidenceCheck(set, mem);
    const candidate = kept[0];
    if (!candidate) {
      yield err("no_alternative", `No new ${current.kind} candidate with evidence was found.`, store.id);
      return;
    }
    const produced = await produceItem(deps, sc, mem, candidate, { hint: params.hint, id: current.id, version: current.version });
    if (!produced.item) {
      yield err("item_dropped", `The new ${current.kind} did not fit the edition format.`, store.id);
      return;
    }

    // Evidence first (the edition owns it), then the version-checked item swap. Both writes go through
    // the repo's locked update, so neither can overwrite an edit made while the agent was working.
    await repo.updateEdition(edition.id, (cur) => {
      const have = new Set(cur.evidence.map((e) => e.id));
      const added = mem.evidenceFor(produced.item!.evidenceIds).filter((e) => !have.has(e.id));
      return added.length ? { ...cur, evidence: [...cur.evidence, ...added] } : cur;
    });
    const saved = await repo.updateEditionItem(edition.id, produced.item, current.version);
    await repo.updateEdition(edition.id, (cur) => ({ ...cur, status: cur.items.some((i) => i.status === "flagged") ? "flagged" : "draft" }));
    await invalidateCard(repo, edition.id);

    yield { type: "item_drafted", storeId: store.id, item: saved };
    yield { type: "guardrail", storeId: store.id, itemId: saved.id, result: saved.guardrail };
    yield { type: "store_done", storeId: store.id, editionId: edition.id };
    yield { type: "run_done", runId, editionIds: [edition.id] };
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") yield err("spend_cap", "The model spend cap has been reached.", store.id);
    else if (e instanceof VersionConflictError) yield err("version_conflict", "Someone changed this item while it was being rewritten. Try again.", store.id);
    else if (e instanceof NotFoundError) yield err("item_not_found", "That item no longer exists.", store.id);
    else {
      log.error("regenerate failed", { editionId: edition.id, err: e });
      yield err("regenerate_failed", "Could not rewrite that item.", store.id);
    }
  }
}
