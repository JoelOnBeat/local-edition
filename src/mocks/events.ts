import type { AgentEvent, Edition, EditionItem } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { buildMockEdition, mockEditionId } from "./editions";
import { delay } from "./helpers";
import { profileEvidenceId } from "./profiles";

export interface MockRunOptions {
  /** Pause between events so the UI can animate. Default 0. */
  delayMs?: number;
  runId?: string;
  signal?: AbortSignal;
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
  for (const store of stores) {
    await tick();
    const edition = buildMockEdition(store, runId);
    yield { type: "store_started", storeId: store.id };
    const tools: [string, Record<string, unknown>, string, string[]][] = [
      ["get_block_profile", { storeId: store.id, radiusM: 800 }, `Read ${edition.evidence[0].summary.replace("Sample data. ", "")}`, [profileEvidenceId(store.id)]],
      ["find_artists", { storeId: store.id, limit: 12 }, "Ranked artists by block affinity.", [edition.items[1].evidenceIds[0]]],
      ["find_partner_places", { storeId: store.id, radiusM: 600 }, "Found one neighbour whose customers match the block.", [edition.items[2].evidenceIds[0]]],
      ["search_local_events", { storeId: store.id }, "Matched an upcoming local listing for the event night.", [edition.items[3].evidenceIds[0]]],
    ];
    for (const [tool, args, summary, evidenceIds] of tools) {
      await tick();
      yield { type: "tool_call", storeId: store.id, tool, args };
      await tick();
      yield { type: "tool_result", storeId: store.id, tool, ok: true, summary, evidenceIds };
    }
    for (const item of edition.items) {
      await tick();
      yield { type: "item_drafted", storeId: store.id, item };
      await tick();
      yield { type: "guardrail", storeId: store.id, itemId: item.id, result: item.guardrail };
    }
    yield { type: "store_done", storeId: store.id, editionId: edition.id };
  }
  yield { type: "run_done", runId, editionIds: stores.map((s) => mockEditionId(s.id)) };
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
    guardrail: { status: "passed", reasons: [] },
  };
  if (next.kind === "special") {
    next.description = hint ? `${next.description} Leaning on: ${hint}.` : `${next.description} A little more citrus this time.`;
  }
  yield { type: "run_started", runId, storeIds: [edition.storeId] };
  yield { type: "store_started", storeId: edition.storeId };
  if (opts.delayMs) await delay(opts.delayMs);
  yield { type: "item_drafted", storeId: edition.storeId, item: next };
  if (opts.delayMs) await delay(opts.delayMs);
  yield { type: "guardrail", storeId: edition.storeId, itemId: next.id, result: next.guardrail };
  yield { type: "store_done", storeId: edition.storeId, editionId: edition.id };
  yield { type: "run_done", runId, editionIds: [edition.id] };
}
