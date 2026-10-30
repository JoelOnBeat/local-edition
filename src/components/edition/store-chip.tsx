import type { Store } from "@/contract";
import { cx, storeColor, storeMonogram } from "../ui";

/** The inline H1 chip, holding the store's monogram tile and name. Sized in em so it follows the heading. */
export function StoreChip({ store, tilt = -1, className }: { store: Pick<Store, "name" | "colorIndex">; tilt?: -1 | 1; className?: string }) {
  const m = storeMonogram(store.name);
  return (
    <span className={cx(
      "-my-[.04em] inline-flex h-[1.08em] max-w-full items-center gap-[.18em] rounded-[.18em] bg-white pl-[.14em] pr-[.24em] align-[-.06em] shadow-raised",
      tilt === -1 ? "-rotate-1" : "rotate-1",
      className,
    )}>
      <span className="flex size-[.8em] shrink-0 items-center justify-center rounded-[.14em] leading-none text-white" style={{ background: storeColor(store.colorIndex) }} aria-hidden>
        <span className="text-[.34em] font-semibold tracking-[-0.02em]">{m}</span>
      </span>
      <span className="truncate">{store.name}</span>
    </span>
  );
}

/** True for a model id served as NVIDIA Nemotron (the only case that earns the NVIDIA mark). */
export const isNvidia = (model: string) => /nvidia|nemotron/i.test(model);
