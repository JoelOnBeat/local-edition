import Link from "next/link";
import { SampleChainLink } from "@/components/account/session-links";
import { BRAND_MARKS, BrandGlyph, Chevron, buttonClass, type Brand } from "@/components/ui";
import { SectionHeader, Icon } from "./section";

/** Lit tiles in the 15×6 field: [column, row, brand]. Placed around the edges so the heading sits in clear space. */
const LIT: Array<[number, number, Brand]> = [
  [3, 0, "square"], [11, 0, "slack"], [1, 2, "qloo"], [13, 2, "gmail"], [12, 3, "outlook"],
  [2, 4, "nvidia"], [4, 5, "nebius"], [10, 5, "gcal"], [14, 4, "cloudflare"], [0, 0, "tavily"],
];

const COLS = 15;
const ROWS = 6;

/**
 * The connections band (ByDefault's assistants band): a field of soft 64px tiles with the tools lit in white, the
 * section heading floating in the middle. Below 768px the field becomes a row of round marks above the heading.
 */
export function LandingTiles() {
  const lit = new Map(LIT.map(([c, r, b]) => [`${c}-${r}`, b]));
  return (
    <section className="py-12" aria-labelledby="tiles-title">
      <div className="relative isolate border-y border-rule">
        <div aria-hidden className="absolute inset-0 hidden overflow-hidden md:block [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
          <div className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(15,4rem)] gap-3">
            {Array.from({ length: COLS * ROWS }, (_, i) => {
              const key = `${i % COLS}-${Math.floor(i / COLS)}`;
              const brand = lit.get(key);
              return brand ? (
                <span key={key} className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-ring-md" style={{ color: BRAND_MARKS[brand].hex }}>
                  <BrandGlyph brand={brand} colored className="size-8" />
                </span>
              ) : (
                <span key={key} className="size-16 rounded-2xl bg-well shadow-[inset_0_0_0_1px_var(--well-ring)]" />
              );
            })}
          </div>
        </div>
        <div className="relative flex min-h-[506px] flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-6 flex -space-x-1.5 md:hidden" aria-hidden>
            {LIT.map(([, , b]) => (
              <span key={b} style={{ color: BRAND_MARKS[b].hex }} className="flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-rule transition-transform duration-150 ease-quint hover:z-10 hover:scale-110">
                <BrandGlyph brand={b} colored className="size-3.5" />
              </span>
            ))}
          </div>
          <div>
            <SectionHeader
              id="tiles-title" pill="Connections" pillIcon={Icon.plug}
              title="Plugs into the tools a chain already runs."
              lede="Menus from Square, approvals in Slack, staff cards by email and a calendar feed for every event night."
              actions={
                <>
                  <Link href="/signin" className={buttonClass("primary", "sm", "gap-1.5 pr-2.5")}>Start free<Chevron className="size-3.5" /></Link>
                  <SampleChainLink className={buttonClass("secondary", "sm")} signedOutLabel="Try the sample chain" />
                </>
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
