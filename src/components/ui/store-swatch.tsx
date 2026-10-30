import { cx } from "./cx";

/** The CSS variable for a store's colour. A store's colour appears only as its tile, its map pin and its chart series. */
export const storeColor = (colorIndex: number): string => `var(--store-${((Math.max(1, colorIndex) - 1) % 8) + 1})`;

/** "Williamsburg" → W, "Park Slope" → PS, "Long Island City" → LIC. */
export function storeMonogram(name: string | undefined): string {
  if (!name) return "·";
  const words = name.replace(/^Kettle\s*&\s*Kiln\s*/i, "").split(/[\s-]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("") || name[0]!.toUpperCase();
}

const TILE = { sm: "size-5 rounded-[5px] text-[9px]", md: "size-6 rounded-md text-[10px]", lg: "size-7 rounded-[7px] text-[11px]" } as const;

/** A store's monogram tile: its colour fill, white letters, a faint ring. */
export function StoreTile({ colorIndex, name, size = "md", className }: { colorIndex: number; name?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const mono = storeMonogram(name);
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center font-semibold leading-none tracking-[-0.02em] text-white", TILE[size], className)}
      style={{ background: storeColor(colorIndex), boxShadow: "0 0 0 1px rgb(42 37 36 / .08)" }}
      aria-hidden
    >
      <span className={cx(mono.length > 2 && "scale-[.86]")}>{mono}</span>
    </span>
  );
}

/** A store's tile, optionally with its name. Kept for older call sites (was a colour square). */
export function StoreSwatch({ colorIndex, name, size = "md", className }: { colorIndex: number; name?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2", className)}>
      <StoreTile colorIndex={colorIndex} name={name} size={size} />
      {name ? <span className="truncate">{name}</span> : null}
    </span>
  );
}
