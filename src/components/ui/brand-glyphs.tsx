/**
 * Official brand marks (single-colour paths), used nominatively at small sizes inside our tiles and on the landing logo
 * wall. Sources are listed per mark. Filled in from the official files; a brand without one falls back to a monogram.
 */
export type Brand =
  | "qloo" | "nvidia" | "nebius" | "tavily" | "cloudflare" | "square" | "slack" | "gmail" | "outlook" | "gcal";

export interface BrandMark {
  name: string;
  /** Brand colour for hover / colour mode. */
  hex: string;
  viewBox: string;
  /** Path data for a single-colour mark (fill currentColor). */
  paths: string[];
  /** Optional official multi-colour version: [d, fill][] */
  color?: Array<[string, string]>;
  /** Wordmark-only brands render wider. */
  wordmark?: boolean;
  source: string;
}

export const BRAND_MARKS: Partial<Record<Brand, BrandMark>> = {};

export function BrandGlyph({ brand, colored, className }: { brand: Brand; colored?: boolean; className?: string }) {
  const m = BRAND_MARKS[brand];
  if (!m) return null;
  return (
    <svg viewBox={m.viewBox} className={className} fill="currentColor" role="img" aria-label={m.name}>
      {colored && m.color ? m.color.map(([d, fill], i) => <path key={i} d={d} fill={fill} />) : m.paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
