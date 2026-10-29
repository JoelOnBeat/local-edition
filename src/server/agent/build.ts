import type { AgentEvent, Edition, EditionItem, Store } from "@/contract";
import { newId } from "@/lib/ids";
import { createLogger } from "../log";
import { HttpError, UpstreamError } from "../http/errors";
import { reapStaleDrafts } from "../store/reaper";
import { acquireBuildLock, ApprovalsAppeared, hasApprovals, releaseBuildLock, type BuildLock } from "./build-lock";
import { evidenceCheck, produceItem } from "./items";
import { runStoreAgent } from "./loop";
import { flush, withMetrics } from "./metrics";
import { recordSteps } from "./stats";
import { dropMessage, verifyStep } from "./verify";
import { AGENT_MODEL, COPY_MODEL, FALLBACK_AGENT_LABEL, type AgentDeps, type StoreContext } from "./ports";
import { invalidateCard } from "./card-state";
import { mondayOf } from "./util";

const log = createLogger("agent:build");

export interface BuildParams {
  workspaceId: string;
  /** Omit to build every store in the workspace. */
  storeIds?: string[];
  /** ISO Monday; defaults to the current week. */
  weekOf?: string;
  /** Reuse a run id minted by the caller (the Monday job). */
  runId?: string;
  /** Rebuild stores whose current edition has approved or edited items (their work is replaced). */
  force?: boolean;
  /** A build lock the caller already took (the route does, to answer 409 before streaming). */
  lock?: BuildLock;
}

const err = (code: string, message: string, storeId?: string): AgentEvent => ({ type: "error", ...(storeId ? { storeId } : {}), code, message });

/**
 * Build this week's edition for each store: tool loop -> evidence check -> copy -> guardrails ->
 * persisted Edition. Yields every event in docs/CONTRACT.md. Stores run one after another so the
 * stream reads as a story; a failing store reports an error and the run carries on.
 */
export async function* buildEditions(params: BuildParams, deps: AgentDeps): AsyncGenerator<AgentEvent> {
  const { repo } = deps;
  let lock = params.lock;
  if (!lock) {
    try {
      lock = await acquireBuildLock(repo, params.workspaceId);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      yield err(e.code, e.message);
      return;
    }
  }
  try {
    yield* runBuild(params, withMetrics(deps));
  } finally {
    await releaseBuildLock(repo, lock);
  }
}

async function* runBuild(params: BuildParams, deps: AgentDeps): AsyncGenerator<AgentEvent> {
  const { repo } = deps;
  const workspace = await repo.getWorkspace(params.workspaceId);
  const chain = workspace && (await repo.getChain(workspace.chainId));
  if (!workspace || !chain) {
    yield err("workspace_not_found", "That workspace does not exist.");
    return;
  }
  const all = await repo.listStores(chain.id);
  const wanted = params.storeIds;
  const unknown = wanted?.filter((id) => !all.some((s) => s.id === id)) ?? [];
  if (unknown.length) {
    yield err("unknown_store", `Unknown store: ${unknown.join(", ")}.`);
    return;
  }
  const stores = wanted ? all.filter((s) => wanted.includes(s.id)) : all;
  // A build killed mid-store leaves its edition `drafting`; flag those before looking at what exists.
  await reapStaleDrafts(repo, await repo.listEditions({ storeIds: all.map((s) => s.id) }), deps.now());
  const menu = await repo.listMenu(chain.id);
  const weekOf = params.weekOf ?? mondayOf(deps.now());
  const runId = params.runId ?? newId("run");

  yield { type: "run_started", runId, storeIds: stores.map((s) => s.id) };
  const editionIds: string[] = [];
  try {
    for (const [i, store] of stores.entries()) {
      try {
        const id = yield* buildStore(deps, { chain, store, menu, weekOf }, runId, params.force === true, i === 0);
        if (id) editionIds.push(id);
      } catch (e) {
        if (e instanceof UpstreamError && e.code === "spend_cap") {
          yield* flush(deps);
          yield err("spend_cap", "The model spend cap has been reached, so the build stopped.", store.id);
          return;
        }
        log.error("store build failed", { storeId: store.id, err: e });
        yield* flush(deps);
        yield err("store_failed", `Could not finish the edition for ${store.name}.`, store.id);
      }
    }
    yield { type: "run_done", runId, editionIds };
  } finally {
    // Whatever the run spent is tallied for /api/proof, even when it stopped early.
    await recordSteps(repo, deps.sink?.all ?? [], editionIds.length, deps.now());
  }
}

const KEPT_APPROVALS = (name: string) => `Kept ${name} as it is: it has approved or edited items. Rebuild with force to replace them.`;

/** Returns the edition id, or null when the store was left alone because head office already worked on it. */
async function* buildStore(deps: AgentDeps, sc: StoreContext, runId: string, force: boolean, first: boolean): AsyncGenerator<AgentEvent, string | null> {
  const { repo } = deps;
  const { store, weekOf } = sc;
  const existing = await repo.getEditionForWeek(store.id, weekOf);
  if (existing && !force && hasApprovals(existing)) {
    yield err("has_approvals", KEPT_APPROVALS(store.name), store.id);
    return null;
  }
  if (deps.sink) deps.sink.storeId = store.id;
  yield { type: "store_started", storeId: store.id };

  const issueNo = existing?.issueNo ?? (await nextIssueNo(deps, store, weekOf));
  const { set, mem, usedFallback } = yield* runStoreAgent({ sc, deps });
  const checked = evidenceCheck(set, mem);
  for (const d of checked.dropped) yield err("item_dropped", dropMessage(d.kind, d.reason), store.id);
  // The evidence verifier recomputes lifts and re-checks every cited id against the Qloo payload; drops announce themselves.
  const { kept } = yield* verifyStep(deps, sc.chain, store.id, mem, checked, { seed: deps.seedBadItem === true && first });
  yield* flush(deps);

  const fresh: Edition = {
    id: existing?.id ?? newId("ed"),
    storeId: store.id,
    weekOf,
    issueNo,
    items: [],
    evidence: [],
    status: "drafting",
    generatedBy: { agentModel: usedFallback ? FALLBACK_AGENT_LABEL : AGENT_MODEL, copyModel: COPY_MODEL, runId },
    createdAt: deps.now().toISOString(),
  };
  let edition: Edition;
  if (existing) {
    // Version-checked: refuse if approvals landed while the agent was working (unless forced).
    try {
      edition = await repo.updateEdition(existing.id, (cur) => {
        if (!force && hasApprovals(cur)) throw new ApprovalsAppeared();
        return { ...fresh, id: cur.id };
      });
    } catch (e) {
      if (!(e instanceof ApprovalsAppeared)) throw e;
      yield err("has_approvals", KEPT_APPROVALS(store.name), store.id);
      return null;
    }
    await invalidateCard(repo, edition.id);
  } else {
    edition = await repo.putEdition(fresh);
  }

  try {
    // Copy and guardrails for the kept items run concurrently; events still go out in item order.
    const pending = kept.map((c) => produceItem(deps, sc, mem, c).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })));
    for (const [i, settled] of pending.entries()) {
      const r = await settled;
      yield* flush(deps);
      if (!r.ok) {
        if (r.error instanceof UpstreamError && r.error.code === "spend_cap") throw r.error;
        log.error("item failed", { kind: kept[i].kind, err: r.error });
        yield err("item_failed", `Could not write the ${kept[i].kind} item.`, store.id);
        continue;
      }
      const item = r.value.item;
      if (!item) {
        yield err("item_dropped", `The ${kept[i].kind} item was dropped: it did not fit the edition format.`, store.id);
        continue;
      }
      edition = await repo.updateEdition(edition.id, (cur) => {
        const items = [...cur.items, item];
        return { ...cur, items, evidence: mem.evidenceFor([...new Set(items.flatMap((x) => x.evidenceIds))]) };
      });
      yield { type: "item_drafted", storeId: store.id, item };
      yield { type: "guardrail", storeId: store.id, itemId: item.id, result: item.guardrail };
    }

    if (!edition.items.length) yield err("no_items", `No items could be built for ${store.name}.`, store.id);
    edition = await repo.updateEdition(edition.id, (cur) => ({ ...cur, status: cur.items.length === 0 || cur.items.some(isFlagged) ? "flagged" : "draft" }));
  } finally {
    // A closed stream (client left) or a thrown error must not leave the edition 'drafting' forever.
    await repo.updateEdition(edition.id, (cur) => (cur.status === "drafting" ? { ...cur, status: "flagged" } : cur)).catch(() => undefined);
  }
  yield { type: "store_done", storeId: store.id, editionId: edition.id };
  return edition.id;
}

const isFlagged = (i: EditionItem) => i.status === "flagged";

async function nextIssueNo(deps: AgentDeps, store: Store, weekOf: string): Promise<number> {
  const prior = await deps.repo.listEditions({ storeIds: [store.id] });
  return prior.filter((e) => e.weekOf !== weekOf).reduce((max, e) => Math.max(max, e.issueNo), 0) + 1;
}
