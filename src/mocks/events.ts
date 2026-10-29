import type { AgentEvent, Edition, EditionItem } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { buildMockEdition } from "./editions";
import { delay } from "./helpers";
import { mockStep, storeStepPlan } from "./metrics";
import { profileEvidenceId } from "./profiles";
import { MOCK_REVIEWS } from "./upgrade-editions";

export interface MockRunOptions {
  /** Pause between events so the UI can animate. Default 0. */
  delayMs?: number;
  runId?: string;
  signal?: AbortSignal;
  /** Stores whose current edition has approved or edited items; a build skips them unless `force`. */
  approvedStoreIds?: ReadonlySet<string>;
  force?: boolean;
}

/** A fresh build never ships an approved or certified item: those states come later, from head office and the job. */
function asDraft(item: EditionItem): EditionItem {
  const { status, rail, reasons, original } = item.guardrail;
  return {
    ...item,
    status: item.status === "approved" || item.status === "edited" ? "draft" : item.status,
    version: 0,
    guardrail: { status, ...(rail ? { rail } : {}), reasons, ...(original ? { original } : {}), checkedBy: "live" },
  };
}

/** A believable agent run for the given stores: profile, artists, places, event, then copy and guardrails. */
export async function* mockBuildEvents(storeIds?: string[], opts: MockRunOptions = {}): AsyncGenerator<AgentEvent> {
  const stores = SAMPLE_STORES.filter((s) => !storeIds?.length || storeIds.includes(s.id));
  const runId = opts.runId ?? "run_sample_0001";
  const tick = async () => {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (opts.delayMs) await delay(opts.delayMs);
  };

  yield { type: "run_started", runId, storeIds: stores.map((s) => s.id) };
  const built: string[] = [];
  let done = 0;
  for (const store of stores) {
    await tick();
    if (!opts.force && opts.approvedStoreIds?.has(store.id)) {
      yield { type: "error", storeId: store.id, code: "has_approvals", message: `${store.name} already has approved items this week. Rebuild it with force to replace them.` };
      yield { type: "progress", runId, done: ++done, total: stores.length };
      continue;
    }
    const edition = buildMockEdition(store, runId);
    const plan = storeStepPlan(store.id);
    yield { type: "store_started", storeId: store.id };
    const summaries = [
      `Read ${edition.evidence[0].summary.replace("Sample data. ", "")}`,
      "Ranked artists by block affinity.",
      "Found one neighbour whose customers match the block.",
      "Matched an upcoming local listing for the event night.",
    ];
    const evidenceFor = [profileEvidenceId(store.id), edition.items[1].evidenceIds[0], edition.items[2].evidenceIds[0], edition.items[3].evidenceIds[0]];
    const args: Record<string, unknown>[] = [{ storeId: store.id, radiusM: 800 }, { storeId: store.id, limit: 12 }, { storeId: store.id, radiusM: 600 }, { storeId: store.id }];
    for (const [i, step] of plan.tools.entries()) {
      await tick();
      yield step.agent; // the agent call that chose this tool
      yield { type: "tool_call", storeId: store.id, tool: step.tool, args: args[i] };
      await tick();
      if (step.embed) yield step.embed;
      yield { type: "tool_result", storeId: store.id, tool: step.tool, ok: true, summary: summaries[i], evidenceIds: [evidenceFor[i]] };
    }
    yield plan.finalAgent;
    for (const item of edition.items) {
      await tick();
      yield plan.copy(item.kind);
      const drafted = asDraft(item);
      yield { type: "item_drafted", storeId: store.id, item: drafted };
      await tick();
      yield plan.check(item.kind);
      yield { type: "guardrail", storeId: store.id, itemId: drafted.id, result: drafted.guardrail };
    }
    yield { type: "store_done", storeId: store.id, editionId: edition.id };
    built.push(edition.id);
    yield { type: "progress", runId, done: ++done, total: stores.length };
  }
  yield { type: "run_done", runId, editionIds: built };
}

/** The Ultra pass over the workspace's editions: one big review call, then a verdict per store. */
export async function* mockReviewEvents(editions: Edition[], opts: MockRunOptions = {}): AsyncGenerator<AgentEvent> {
  const runId = opts.runId ?? "run_sample_review";
  const storeIds = editions.map((e) => e.storeId);
  yield { type: "run_started", runId, storeIds };
  if (opts.delayMs) await delay(opts.delayMs);
  yield mockStep("review", `${runId}:ultra`, { tool: "review_editions" });
  let done = 0;
  for (const edition of editions) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (opts.delayMs) await delay(opts.delayMs);
    const r = MOCK_REVIEWS[edition.storeId.replace(/^store_/, "")];
    yield {
      type: "review", storeId: edition.storeId,
      verdict: r?.verdict ?? "approve",
      reason: r?.reason ?? "No overlap with any other store's edition.",
      clashWith: r?.clashWith ?? [],
      hint: r?.hint ?? null,
      reviewedBy: MOCK_REVIEWS.williamsburg.reviewedBy,
    };
    yield { type: "progress", runId, done: ++done, total: editions.length };
  }
  yield { type: "run_done", runId, editionIds: editions.map((e) => e.id) };
}

/** Events for regenerating one item: a fresh draft at the next version, then its guardrail result. */
export async function* mockRegenerateEvents(
  edition: Edition,
  itemId: string,
  hint?: string,
  opts: MockRunOptions = {},
): AsyncGenerator<AgentEvent> {
  const current = edition.items.find((i) => i.id === itemId);
  const runId = opts.runId ?? "run_sample_regen";
  if (!current) {
    yield { type: "error", code: "item_not_found", message: "That item is no longer on this edition." };
    return;
  }
  const next: EditionItem = {
    ...current,
    status: "draft",
    version: current.version + 1,
    guardrail: { status: "passed", reasons: [], checkedBy: "live" },
  };
  if (next.kind === "special") {
    next.description = hint ? `${next.description} Leaning on: ${hint}.` : `${next.description} A little more citrus this time.`;
  }
  yield { type: "run_started", runId, storeIds: [edition.storeId] };
  yield { type: "store_started", storeId: edition.storeId };
  if (opts.delayMs) await delay(opts.delayMs);
  yield mockStep("copy", `${runId}:${itemId}:${next.version}`, { storeId: edition.storeId, tool: `write_${next.kind}`, warm: true });
  yield { type: "item_drafted", storeId: edition.storeId, item: next };
  if (opts.delayMs) await delay(opts.delayMs);
  yield mockStep("check", `${runId}:${itemId}:${next.version}:check`, { storeId: edition.storeId, tool: "self_check_output", warm: true });
  yield { type: "guardrail", storeId: edition.storeId, itemId: next.id, result: next.guardrail };
  yield { type: "store_done", storeId: edition.storeId, editionId: edition.id };
  yield { type: "run_done", runId, editionIds: [edition.id] };
}
