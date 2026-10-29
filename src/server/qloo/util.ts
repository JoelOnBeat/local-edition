import type { TagKind } from "@/contract";

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface BlockTagType {
  /** Value for `filter.tag.types` (one per call: only single values are documented). */
  type: string;
  kind: TagKind;
  /** Human label used in evidence summaries. */
  label: string;
}

/** Tag namespaces that describe a block (docs: schema-taxonomy; tech brief 1a). */
export const BLOCK_TAG_TYPES: readonly BlockTagType[] = [
  { type: "urn:tag:ambience:qloo", kind: "ambience", label: "ambience" },
  { type: "urn:tag:neighborhood_characteristic:qloo", kind: "other", label: "block character" },
  { type: "urn:tag:good_for:qloo", kind: "activity", label: "occasions" },
  { type: "urn:tag:cuisine:qloo", kind: "cuisine", label: "cuisine" },
  { type: "urn:tag:specialty_dish:place", kind: "flavour", label: "specialty dishes" },
  { type: "urn:tag:menu_highlight:qloo", kind: "flavour", label: "menu highlights" },
  { type: "urn:tag:genre:music", kind: "music", label: "music genres" },
];

export function kindForTag(tagId: string): TagKind {
  const hit = BLOCK_TAG_TYPES.find((t) => tagId.startsWith(`${t.type}:`) || tagId === t.type);
  if (hit) return hit.kind;
  const ns = tagId.split(":")[2];
  if (ns === "cuisine") return "cuisine";
  if (ns === "ambience" || ns === "decor" || ns === "setting") return "ambience";
  if (ns === "good_for") return "activity";
  if (ns === "specialty_dish" || ns === "menu_highlight") return "flavour";
  return "other";
}

export const toPct = (n: number) => `${Math.round(n * 100)}`;
export const signed = (n: number, dp = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(dp)}`;
export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
