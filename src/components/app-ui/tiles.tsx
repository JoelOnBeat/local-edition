"use client";

import { useId } from "react";
import type { Store } from "@/contract";
import type { Provider } from "@/components/ui";
import { StoreTile, cx } from "@/components/ui";
import { BRAND_SVG, type Brand } from "./brand-svg";

/** Store monogram tiles and provider logo tiles: the 24/28px squares every table, chip and pin is built from. */

/** Up to `max` overlapping store tiles, then a "+N" chip. */
export function StoreStack({ stores, max = 3, size = "sm" }: { stores: Pick<Store, "id" | "name" | "colorIndex">[]; max?: number; size?: "sm" | "md" }) {
  const shown = stores.slice(0, max);
  const rest = stores.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1">
      {shown.map((s) => <StoreTile key={s.id} colorIndex={s.colorIndex} name={s.name} size={size} className="ring-2 ring-white" />)}
      {rest > 0 ? (
        <span className={cx("relative inline-flex items-center justify-center rounded-md bg-stone-100 px-1 font-medium text-ink-2 ring-2 ring-white tnum", size === "sm" ? "h-5 min-w-5 text-[10px]" : "h-6 min-w-6 text-[11px]")}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** Which official mark stands for each provider in the app's data. */
const BRAND_OF: Record<Provider, Brand> = {
  qloo: "qloo",
  nemotron: "nvidia",
  guardrails: "nvidia",
  tokenfactory: "nebius",
  tavily: "tavily",
  square: "square",
  slack: "slack",
  gmail: "gmail",
  outlook: "outlook",
  calendar: "calendar",
  eventbrite: "eventbrite",
};

export const PROVIDER_NAME: Record<Provider, string> = {
  qloo: "Qloo",
  nemotron: "NVIDIA Nemotron",
  guardrails: "NeMo Guardrails",
  tokenfactory: "Nebius Token Factory",
  tavily: "Tavily",
  square: "Square",
  slack: "Slack",
  gmail: "Gmail",
  outlook: "Outlook",
  calendar: "Calendar feed",
  eventbrite: "Eventbrite",
};

/** An official brand mark as inline SVG. Gradient and mask ids are made unique per instance. */
export function BrandMark({ brand, size = 16, className }: { brand: Brand; size?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = BRAND_SVG[brand];
  const body = svg.body.replace(/id="([^"]+)"/g, `id="$1${uid}"`).replace(/url\(#([^)]+)\)/g, `url(#$1${uid})`);
  return (
    <svg width={size} height={size} viewBox={svg.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden className={cx("shrink-0", className)} dangerouslySetInnerHTML={{ __html: body }} />
  );
}

const TILE = { xs: { box: "size-[18px] rounded-[5px]", mark: 12 }, sm: { box: "size-6 rounded-md", mark: 14 }, md: { box: "size-7 rounded-[7px]", mark: 16 }, lg: { box: "size-10 rounded-[10px]", mark: 22 } } as const;

/** A white tile holding a provider's mark (the design system's brand favicon tiles). `muted` greys out an absent provider. */
export function LogoTile({ provider, size = "sm", muted, className, title }: { provider: Provider; size?: keyof typeof TILE; muted?: boolean; className?: string; title?: string }) {
  const t = TILE[size];
  const brand = BRAND_OF[provider];
  return (
    <span
      title={title ?? PROVIDER_NAME[provider]}
      className={cx("inline-flex shrink-0 items-center justify-center bg-white shadow-ring-xs", t.box, muted && "opacity-30 grayscale", className)}
    >
      <BrandMark brand={brand} size={brand === "nebius" ? t.mark + 2 : t.mark} className={brand === "nebius" ? "rounded-[3px]" : undefined} />
      <span className="sr-only">{PROVIDER_NAME[provider]}</span>
    </span>
  );
}

/** Tile plus the provider's name: the standard way a provider appears in a row. */
export function LogoLabel({ provider, label, size = "sm", className }: { provider: Provider; label?: string; size?: keyof typeof TILE; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink-strong", className)}>
      <LogoTile provider={provider} size={size} />
      <span className="truncate">{label ?? PROVIDER_NAME[provider]}</span>
    </span>
  );
}
