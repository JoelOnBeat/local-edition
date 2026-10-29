import { DEFAULT_CHECKED_BY, type Edition, type EditionItem, type GuardrailResult, type JobResult, type PendingJobItem, type StaffCard } from "@/contract";
import { deriveEditionStatus } from "../handlers/items";
import { ensureDemoWorkspace } from "../session";
import { NotFoundError, type Repo } from "../store";
import { sha256Hex } from "./batch-runs";

/**
 * Certification by the NeMo Guardrails library in the Nebius job. `listPending` is what the job reads; `applyResults`
 * writes its verdicts back. Both work on the canonical demo workspace's newest finished edition per store.
 */

export const NEMO_CHECKER = "nemo-guardrails@nebius-job" as const;
/** Most items one job run reads; the rest wait for the next run. Keeps the results body well under 256 KB. */
export const CERTIFY_CAP = 200;
const SNAPSHOT_KEY = "certify:snapshot";
/** The job reads, thinks and posts; a run that takes longer than this posts nothing the server will accept. */
const SNAPSHOT_TTL_SECONDS = 6 * 3600;
const MAX_TEXT = 4000;

const join = (parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n").slice(0, MAX_TEXT);

/** The copy the job checks for an item. Event text includes the web tie-in's title unless triage dropped it. */
export function itemText(item: EditionItem): string {
  switch (item.kind) {
    case "special": return join([item.name, item.description, item.staffLine]);
    case "sound": return join([item.brief, item.mood]);
    case "partner": return join([item.reason, item.offerIdea]);
    case "event": return join([item.title, item.description, item.tieIn && item.tieIn.triage?.kept !== false ? item.tieIn.title : null]);
  }
}

export const cardText = (card: StaffCard): string => join(card.lines.map((l) => `${l.heading}: ${l.body}`));

const key = (editionId: string, itemId: string) => `${editionId}:${itemId}`;
const digest = async (text: string) => (await sha256Hex(text)).slice(0, 16);

const needsCertifying = (g: GuardrailResult) => (g.checkedBy ?? DEFAULT_CHECKED_BY) !== NEMO_CHECKER;

async function demoEditions(repo: Repo): Promise<{ editions: Edition[]; brandVoice: string[] }> {
  const demo = await ensureDemoWorkspace(repo);
  const chain = await repo.getChain(demo.chainId);
  const stores = await repo.listStores(demo.chainId);
  const editions = await repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  return { editions, brandVoice: chain?.brandVoice ?? [] };
}

/**
 * Every item (and staff card) of the demo editions that the NeMo job has not certified yet. An edit makes a live
 * verdict again, so an edited item comes back. A snapshot of what was sent is kept so a verdict for copy that
 * changed meanwhile is dropped, not applied to the new text.
 */
export async function listPending(repo: Repo, cap = CERTIFY_CAP): Promise<PendingJobItem[]> {
  const { editions, brandVoice } = await demoEditions(repo);
  const items: PendingJobItem[] = [];
  const snapshot: Record<string, string> = {};
  const push = async (editionId: string, itemId: string, kind: PendingJobItem["kind"], text: string) => {
    if (!text || items.length >= cap) return;
    items.push({ editionId, itemId, kind, text, brandVoice });
    snapshot[key(editionId, itemId)] = await digest(text);
  };
  for (const edition of editions) {
    for (const item of edition.items) {
      if (item.status !== "rejected" && needsCertifying(item.guardrail)) await push(edition.id, item.id, item.kind, itemText(item));
    }
    const card = await repo.getStaffCardByEdition(edition.id);
    if (card && card.lines.length > 0 && needsCertifying(card.guardrail)) await push(edition.id, card.token, "card", cardText(card));
  }
  const previous = (await repo.cacheGet<Record<string, string>>(SNAPSHOT_KEY)) ?? {};
  await repo.cachePut(SNAPSHOT_KEY, { ...previous, ...snapshot }, SNAPSHOT_TTL_SECONDS);
  return items;
}

export interface ApplyOutcome {
  updated: number;
  passed: number;
  blocked: number;
  flipped: number;
  stale: number;
  skipped: number;
  storeIds: string[];
}

/** The verdict as stored: always NeMo's, with the time and job id the job reported (or ours). */
function certified(g: GuardrailResult, now: string, jobId: string | null): GuardrailResult {
  return { ...g, checkedBy: NEMO_CHECKER, certifiedAt: g.certifiedAt ?? now, ...(g.jobId ?? jobId ? { jobId: g.jobId ?? jobId! } : {}) };
}

/**
 * Writes verdicts. NeMo blocking an approved (or draft, or edited) item flips it to `flagged` and bumps its version,
 * so a head-office tab holding the old version gets a 409 instead of approving blocked copy. A verdict is skipped when
 * the item is gone or rejected, when `unchecked` (the job never sends it), when the copy changed since it was read, or
 * when no snapshot of it exists.
 */
export async function applyResults(repo: Repo, results: JobResult[], opts: { jobId: string | null; now?: () => Date }): Promise<ApplyOutcome> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const snapshot = (await repo.cacheGet<Record<string, string>>(SNAPSHOT_KEY)) ?? {};
  const out: ApplyOutcome = { updated: 0, passed: 0, blocked: 0, flipped: 0, stale: 0, skipped: 0, storeIds: [] };
  const tally = (g: GuardrailResult) => { if (g.status === "blocked") out.blocked++; else out.passed++; };
  const byEdition = new Map<string, JobResult[]>();
  for (const r of results) byEdition.set(r.editionId, [...(byEdition.get(r.editionId) ?? []), r]);

  for (const [editionId, group] of byEdition) {
    const edition = await repo.getEdition(editionId);
    if (!edition) { out.skipped += group.length; continue; }
    const itemById = new Map(edition.items.map((i) => [i.id, i]));
    const forItems = new Map(group.filter((r) => itemById.has(r.itemId)).map((r) => [r.itemId, r]));
    const forCards = group.filter((r) => !itemById.has(r.itemId));

    // Copy that still matches what the job was sent, at the version we read. The edit below re-checks the version.
    const readVersion = new Map<string, number>();
    for (const [itemId] of forItems) {
      const item = itemById.get(itemId)!;
      if (snapshot[key(editionId, itemId)] === (await digest(itemText(item)))) readVersion.set(itemId, item.version);
    }

    let local = { updated: 0, passed: 0, blocked: 0, flipped: 0, stale: 0, skipped: 0 };
    try {
      await repo.updateEdition(editionId, (current) => {
        local = { updated: 0, passed: 0, blocked: 0, flipped: 0, stale: 0, skipped: 0 };
        const items = current.items.map((item): EditionItem => {
          const r = forItems.get(item.id);
          if (!r) return item;
          if (item.status === "rejected" || r.guardrail.status === "unchecked") { local.skipped++; return item; }
          if (readVersion.get(item.id) !== item.version) { local.stale++; return item; }
          const guardrail = certified(r.guardrail, now, opts.jobId);
          const flip = guardrail.status === "blocked" && item.status !== "flagged";
          local.updated++;
          if (guardrail.status === "blocked") local.blocked++; else local.passed++;
          if (flip) local.flipped++;
          return { ...item, guardrail, status: flip ? "flagged" : item.status, version: item.version + 1 };
        });
        const next = { ...current, items };
        return { ...next, status: deriveEditionStatus(next) };
      });
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
      out.skipped += group.length;
      continue;
    }
    for (const k of ["updated", "passed", "blocked", "flipped", "stale", "skipped"] as const) out[k] += local[k];
    let changed = local.updated;

    for (const r of forCards) {
      const card = await repo.getStaffCardByToken(r.itemId);
      if (!card || card.editionId !== editionId || r.guardrail.status === "unchecked") { out.skipped++; continue; }
      if (snapshot[key(editionId, r.itemId)] !== (await digest(cardText(card)))) { out.stale++; continue; }
      await repo.putStaffCard({ ...card, guardrail: certified(r.guardrail, now, opts.jobId) });
      changed++;
      tally(r.guardrail);
    }
    out.updated += changed - local.updated;
    if (changed > 0) out.storeIds.push(edition.storeId);
  }
  return out;
}
