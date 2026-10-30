import { BRAND_MARKS, cx } from "@/components/ui";
import { INTEGRATIONS, type Integration } from "./landing-data";

/** A brand's mark: white by default, its own colour on hover (multi-colour brands cross-fade to their official file). */
function Mark({ brand }: { brand: Integration["brand"] }) {
  const m = BRAND_MARKS[brand];
  const mono = m.paths.length > 0;
  return (
    <span className="relative flex size-8 items-center justify-center" style={{ ["--brand" as string]: m.darkHex }}>
      {mono ? (
        <svg
          viewBox={m.viewBox} fill="currentColor" aria-hidden
          className={cx(
            "size-8 text-white/60 transition-[color,opacity] duration-200 ease-quint group-hover/logo:text-[var(--brand)]",
            m.colorSrc && "group-hover/logo:opacity-0",
          )}
        >
          {m.paths.map((d, i) => <path key={i} d={d} fillRule={m.evenOdd ? "evenodd" : undefined} clipRule={m.evenOdd ? "evenodd" : undefined} />)}
        </svg>
      ) : null}
      {m.colorSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.colorSrc} alt="" aria-hidden draggable={false}
          className={cx(
            "size-8 transition-[opacity,filter] duration-200 ease-quint",
            mono ? "absolute inset-0 opacity-0 group-hover/logo:opacity-100" : "opacity-55 grayscale brightness-[2.2] contrast-[.9] group-hover/logo:opacity-100 group-hover/logo:grayscale-0 group-hover/logo:brightness-100 group-hover/logo:contrast-100",
          )}
        />
      ) : null}
    </span>
  );
}

/** The integrations logo wall: ten official marks in a hairline grid, each with its role and the job it does here. */
export function LogoWall({ className }: { className?: string }) {
  return (
    <ul className={cx("grid grid-cols-2 overflow-hidden rounded-2xl bg-white/[.02] shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] sm:grid-cols-3 lg:grid-cols-5", className)}>
      {INTEGRATIONS.map((it) => {
        const m = BRAND_MARKS[it.brand];
        return (
          <li
            key={it.brand}
            className="group/logo relative -mb-px -mr-px flex min-h-[176px] flex-col border-b border-r border-white/[.06] p-5 transition-colors duration-200 hover:bg-white/[.03] sm:p-6"
          >
            <Mark brand={it.brand} />
            <div className="pt-7">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[15px] font-medium leading-5 text-band-ink">{m.name}</span>
                <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[12px] font-medium leading-4 text-band-ink-2">{it.role}</span>
              </p>
              <p className="mt-2 text-[13px] leading-[18px] text-band-ink-3 transition-colors duration-200 group-hover/logo:text-band-ink-2">{it.what}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
