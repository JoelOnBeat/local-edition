import { z } from "zod";
import { ReviewFields, ReviewVerdict, type AgentEvent, type Edition } from "@/contract";
import { newId } from "@/lib/ids";
import { createLogger } from "../log";
import { HttpError, UpstreamError } from "../http/errors";
import { findClashes, type StoreEdition } from "./clash";
import { FIXTURE_REVIEWER, fixtureVerdicts } from "./review-fixture";
import { extractJson } from "./json";
import { flush, withMetrics } from "./metrics";
import { REVIEW_FALLBACK_MODEL, REVIEW_MODEL, type AgentDeps, type ChatMessage, type Reasoning } from "./ports";
import { REVIEW_JSON_SCHEMA, REVIEW_SCHEMA_NAME, reviewSystem, reviewUser } from "./review-prompt";
import { recordSteps } from "./stats";
import { clip, withTimeout } from "./util";

const log = createLogger("agent:review");

type ReviewFields = z.infer<typeof ReviewFields>;

/** The reviewer's answer budget: JSON for up to ~12 stores, with room for some reasoning. */
export const REVIEW_MAX_TOKENS = 2500;
/**
 * Thinking `off` (measured live 29 Oct 2026, 2 stores with one clash, 2,500-token cap): Ultra on `low` and on
 * `default` spent all 2,500 tokens thinking and hit `length` (the thinking text spilled into `content`), costing
 * 7.4 s and $0.007 for an answer that was cut off or lucky to parse; on `off` it answered in 190 tokens, 1.0 s,
 * $0.0014, with a correct verdict and the clash named. The verdicts are short and the `reason` field carries the
 * judgment, so thinking buys nothing here.
 */
export const REVIEW_REASONING: Reasoning = "off";
const REVIEW_TIMEOUT_MS = 90_000;

export interface ReviewParams {
  workspaceId: string;
  /** ISO Monday; omit for the newest week that has editions. */
  weekOf?: string;
}

const Verdicts = z.object({
  reviews: z.array(z.object({ storeId: z.string(), verdict: ReviewVerdict, reason: z.string().min(1), clashWith: z.array(z.string()).default([]), hint: z.string().nullish() })),
});

const err = (code: string, message: string, storeId?: string): AgentEvent => ({ type: "error", ...(storeId ? { storeId } : {}), code, message });
const signature = (e: Edition) => e.items.map((i) => `${i.id}:${i.version}:${i.status}`).join("|");

/**
 * One call to a reviewer model, strict JSON, one parse. Returns the verdicts, or throws so the caller can
 * fall back to the next model. There is no repair retry: a second Ultra call would double the cost.
 */
async function callReviewer(deps: AgentDeps, model: string, messages: ChatMessage[], reasoning: Reasoning) {
  const res = await withTimeout(
    deps.chat.complete({ model, role: "review", tag: REVIEW_SCHEMA_NAME, messages, temperature: 0.2, maxTokens: REVIEW_MAX_TOKENS, reasoning, responseFormat: { name: REVIEW_SCHEMA_NAME, schema: REVIEW_JSON_SCHEMA }, timeoutMs: REVIEW_TIMEOUT_MS }),
    REVIEW_TIMEOUT_MS + 2000,
    "reviewer model",
  );
  const parsed = Verdicts.safeParse(extractJson(res.content));
  if (!parsed.success) throw new UpstreamError("invalid_response", "tokenfactory", "The reviewer did not return the requested JSON.");
  return parsed.data.reviews;
}

/** Clean one raw verdict: known stores only, an approval carries no hint or clash, lengths within the contract. */
export function toReviewFields(raw: z.infer<typeof Verdicts>["reviews"][number], reviewedBy: string, storeIds: Set<string>): ReviewFields {
  const needs = raw.verdict === "needs_change";
  return {
    verdict: raw.verdict,
    reason: clip(raw.reason.trim(), 600),
    clashWith: needs ? [...new Set(raw.clashWith.filter((id) => storeIds.has(id) && id !== raw.storeId))] : [],
    hint: needs && raw.hint?.trim() ? clip(raw.hint.trim(), 600) : null,
    reviewedBy,
  };
}

/**
 * Head office's portfolio review, streamed as AgentEvent. Code finds cross-store clashes first (same partner, same
 * event night, near-identical copy); then ONE call to Nemotron 3 Ultra judges every store's edition against them and
 * returns strict JSON. If Ultra fails, Super VL reviews instead and the verdict says so in `reviewedBy`. Each verdict is
 * saved on its edition and emitted as a `review` event. A `needs_change` hint feeds the regenerate route.
 */
export async function* reviewEditions(params: ReviewParams, base: AgentDeps): AsyncGenerator<AgentEvent> {
  const deps = withMetrics(base);
  try {
    yield* review(params, deps);
  } finally {
    await recordSteps(deps.repo, deps.sink?.all ?? [], 0, deps.now());
  }
}

async function* review(params: ReviewParams, deps: AgentDeps): AsyncGenerator<AgentEvent> {
  const { repo } = deps;
  const workspace = await repo.getWorkspace(params.workspaceId);
  const chain = workspace && (await repo.getChain(workspace.chainId));
  if (!workspace || !chain) { yield err("workspace_not_found", "That workspace does not exist."); return; }
  const stores = await repo.listStores(chain.id);
  const found = await repo.listEditions({ storeIds: stores.map((s) => s.id), weekOf: params.weekOf });
  const usable = found.filter((e) => e.status !== "drafting" && e.items.some((i) => i.status !== "rejected"));
  const weekOf = params.weekOf ?? usable.map((e) => e.weekOf).sort().at(-1);
  const entries: StoreEdition[] = usable
    .filter((e) => e.weekOf === weekOf)
    .flatMap((edition) => {
      const store = stores.find((s) => s.id === edition.storeId);
      return store ? [{ storeId: store.id, storeName: store.name, edition }] : [];
    });
  if (!weekOf || !entries.length) { yield err("no_editions", "There are no built editions to review. Build the week first."); return; }

  const runId = newId("run");
  yield { type: "run_started", runId, storeIds: entries.map((e) => e.storeId) };
  const clashes = await findClashes(deps, entries);
  yield* flush(deps);

  const messages: ChatMessage[] = [{ role: "system", content: reviewSystem(chain) }, { role: "user", content: reviewUser(entries, clashes, weekOf) }];
  let reviewedBy: string = REVIEW_MODEL;
  let verdicts: Awaited<ReturnType<typeof callReviewer>> | null = null;
  try {
    verdicts = await callReviewer(deps, REVIEW_MODEL, messages, REVIEW_REASONING);
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") { yield* flush(deps); yield err("spend_cap", "The model spend cap has been reached, so the review stopped."); return; }
    log.warn("Ultra review failed; falling back", { err: e instanceof UpstreamError ? e.code : (e as Error)?.name });
    yield* flush(deps);
    yield err("reviewer_fallback", "Nemotron 3 Ultra did not answer, so Nemotron 3.5 Super VL reviewed this week instead.");
    reviewedBy = REVIEW_FALLBACK_MODEL;
    try {
      verdicts = await callReviewer(deps, REVIEW_FALLBACK_MODEL, messages, "off");
    } catch (e2) {
      if (e2 instanceof UpstreamError && e2.code === "spend_cap") { yield* flush(deps); yield err("spend_cap", "The model spend cap has been reached, so the review stopped."); return; }
      log.warn("fallback review failed", { err: (e2 as Error)?.name });
    }
  }
  yield* flush(deps);
  // Fixture mode: the sample model's reply names no store of ours (it echoes the schema); answer from the clashes code found (labelled).
  if (deps.seedBadItem && verdicts && !verdicts.some((v) => entries.some((e) => e.storeId === v.storeId))) {
    verdicts = fixtureVerdicts(entries, clashes);
    reviewedBy = FIXTURE_REVIEWER;
  }
  if (!verdicts) { yield err("review_failed", "The review could not be completed. Try again in a moment."); return; }

  const known = new Set(entries.map((e) => e.storeId));
  const seen = new Set<string>();
  for (const entry of entries) {
    const raw = verdicts.find((v) => v.storeId === entry.storeId && !seen.has(v.storeId));
    if (!raw) { yield err("review_missing", `The reviewer returned no verdict for ${entry.storeName}.`, entry.storeId); continue; }
    seen.add(raw.storeId);
    const fields = toReviewFields(raw, reviewedBy, known);
    const saved = await saveReview(deps, entry.edition, fields);
    if (!saved) { yield err("review_stale", `${entry.storeName} changed while it was being reviewed, so the verdict was not saved.`, entry.storeId); continue; }
    yield { type: "review", storeId: entry.storeId, ...fields };
  }
  yield { type: "run_done", runId, editionIds: entries.map((e) => e.edition.id) };
}

/** Writes the verdict unless the edition's items changed since the review began (a rebuild or an edit). */
async function saveReview(deps: AgentDeps, reviewed: Edition, fields: ReviewFields): Promise<boolean> {
  const at = deps.now().toISOString();
  try {
    await deps.repo.updateEdition(reviewed.id, (cur) => {
      if (signature(cur) !== signature(reviewed)) throw new HttpError(409, "review_stale", "The edition changed.");
      return { ...cur, review: { ...fields, at } };
    });
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.code === "review_stale") return false;
    throw e;
  }
}
