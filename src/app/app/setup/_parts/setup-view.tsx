"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Chain, MenuItem, Store } from "@/contract";
import { useWorkspace } from "@/components/app/workspace-context";
import { ErrorState, Notice, SkeletonText, buttonClass, cx } from "@/components/ui";
import { AnchorsStep } from "./anchors-step";
import { MenuStep } from "./menu-step";
import { VoiceStep } from "./voice-step";

/** Onboarding in three steps: menu and stores, brand voice, taste anchors. Each step saves on its own. */

function Step({ n, id, title, lede, done, children }: { n: number; id: string; title: string; lede: string; done: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 grid gap-5 border-t-2 border-ink pt-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
      <div className="grid content-start gap-2">
        <span className={cx("font-display text-[44px] font-extrabold leading-none", done ? "text-ok" : "text-accent")}>{done ? "✓" : n}</span>
        <h2 id={`${id}-h`} className="font-display text-[22px] font-bold leading-tight">{title}</h2>
        <p className="text-[13.5px] leading-[1.5] text-muted">{lede}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SetupView() {
  const { bundle, loading, error, reload } = useWorkspace();
  const [chain, setChain] = useState<Chain | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);

  if (loading) return <SkeletonText lines={8} className="max-w-3xl" />;
  if (error || !bundle) return <ErrorState message={error?.message ?? "The workspace did not load."} onRetry={reload} />;

  const c = chain ?? bundle.chain;
  const m = menu ?? bundle.menu;
  const s = stores ?? bundle.stores;
  const steps = [
    { id: "menu", label: "Menu and stores", done: m.length > 0 && s.length > 0 },
    { id: "voice", label: "Brand voice", done: c.brandVoice.length > 0 },
    { id: "anchors", label: "Taste anchors", done: c.anchors.length > 0 },
  ];
  const ready = steps.every((x) => x.done);

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <h1 className="font-display text-[clamp(30px,4vw,44px)] font-extrabold leading-none tracking-[-0.02em]">Set up your chain</h1>
        <p className="max-w-[68ch] text-[15.5px] text-ink-2">
          Three things and the Monday edition can be written: what you sell and where, how you talk, and which brands your crowd
          also loves. Everything stays editable.
        </p>
        <ol className="flex flex-wrap gap-2">
          {steps.map((x, i) => (
            <li key={x.id}>
              <a href={`#${x.id}`} className={cx("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px]", x.done ? "border-ok text-ok" : "border-rule text-ink-2 hover:border-ink-2")}>
                <span className="font-mono">{x.done ? "✓" : i + 1}</span> {x.label}
              </a>
            </li>
          ))}
        </ol>
        {c.isSample ? (
          <Notice tone="warn">This is the sample chain. Changes stay in your private copy and do not touch anyone else&apos;s.</Notice>
        ) : null}
      </header>

      <Step n={1} id="menu" title="Menu and stores" lede="From Square, so it stays current. A photo and a CSV work too." done={steps[0].done}>
        <MenuStep menu={m} stores={s} onSaved={setMenu} onStores={setStores} reloadWorkspace={() => { setMenu(null); setStores(null); reload(); }} />
      </Step>
      <Step n={2} id="voice" title="Brand voice" lede="Every line of every edition is written in it, and checked against it." done={steps[1].done}>
        <VoiceStep key={c.id} chain={c} onSaved={setChain} />
      </Step>
      <Step n={3} id="anchors" title="Taste anchors" lede="Brands your customers also love. Qloo reads each block through them." done={steps[2].done}>
        <AnchorsStep key={c.id} chain={c} onSaved={setChain} />
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <Link href="/app" className={buttonClass(ready ? "primary" : "secondary", "md", "h-auto min-h-10 whitespace-normal py-2 text-left")}>
          {ready ? "Go to the portfolio and build this week's editions" : "Back to the portfolio"}
        </Link>
        {!ready ? <span className="text-[13.5px] text-muted">Finish the steps without a tick first.</span> : null}
      </div>
    </div>
  );
}
