import type { Evidence, EvidenceMetrics } from "@/contract";
import type { QlooCall } from "./client";

/** Evidence objects per docs/CONTRACT.md: endpoint path only, params never carry a key. */

const SECRET_PARAM = /^(api[-_]?key|key|token|access[-_]?token|auth|authorization|signature|sig|secret|x-api-key)$/i;

export function scrubParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([k]) => !SECRET_PARAM.test(k)));
}

/** Non-cryptographic 53-bit string hash (cyrb53); deterministic ids, same on every runtime. */
export function hash53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function evidenceId(scope: string, path: string, params: Record<string, string>, discriminator = ""): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `ev_${hash53(`${scope}|${path}|${JSON.stringify(sorted)}|${discriminator}`)}`;
}

export interface EvidenceInput {
  /** Store id (or pair) the evidence is about; part of the id so two stores never share one. */
  scope: string;
  call: Pick<QlooCall<unknown>, "path" | "params" | "mode">;
  summary: string;
  metrics?: EvidenceMetrics;
  entityIds?: string[];
  discriminator?: string;
  mode?: Evidence["mode"];
  now: Date;
}

const finite = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);

export function buildEvidence(i: EvidenceInput): Evidence {
  const params = scrubParams(i.call.params);
  const m = i.metrics ?? {};
  const metrics: EvidenceMetrics = {};
  for (const k of ["affinity", "popularity", "lift", "distanceM", "relevance"] as const) {
    const v = finite(m[k]);
    if (v !== undefined) metrics[k] = v;
  }
  return {
    id: evidenceId(i.scope, i.call.path, params, i.discriminator),
    source: "qloo",
    endpoint: i.call.path,
    params,
    summary: i.summary.trim() || "Qloo result",
    metrics,
    entityIds: i.entityIds ?? [],
    fetchedAt: i.now.toISOString(),
    mode: i.mode ?? i.call.mode,
  };
}
