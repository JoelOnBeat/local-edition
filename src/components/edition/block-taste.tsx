import type { BlockProfile } from "@/contract";
import { CardBand, StatusBar } from "../ui";
import { Icon } from "../app-ui/icons";
import { Skel } from "../app-ui/states";
import { LogoTile } from "../app-ui/tiles";
import { signed } from "../app-ui/status";

/** The block's top Qloo tags as a rank list: affinity bar, lift over the city in mono. */
export function BlockTaste({ profile, loading }: { profile?: BlockProfile; loading: boolean; colorIndex?: number }) {
  return (
    <CardBand
      title="Block profile"
      icon={<Icon name="layers" />}
      actions={<span className="flex items-center gap-1.5 text-[13px] text-muted"><LogoTile provider="qloo" size="xs" />vs New York</span>}
      flush
      footer={<span className="text-[13px] text-muted">Lift is this block&apos;s affinity minus the city baseline.</span>}
    >
      {loading && !profile ? (
        <div className="grid gap-4 p-4" role="status" aria-label="Loading">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3"><Skel className="h-2.5 w-4" /><Skel className="h-2.5 flex-1" /><Skel className="h-2.5 w-10" /></div>)}
        </div>
      ) : !profile || profile.tags.length === 0 ? (
        <p className="px-4 py-6 text-center text-[14px] text-muted">Qloo returned no taste signal for this block yet.</p>
      ) : (
        <ol className="divide-y divide-rule-row px-4 py-1">
          {profile.tags.slice(0, 6).map((t, i) => (
            <li key={t.tagId} className="grid grid-cols-[20px_minmax(0,1fr)_auto_52px] items-center gap-x-2 py-2.5">
              <span className="text-[12px] font-medium text-ink-2 tnum">{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-ink-strong" title={t.name}>{t.name}</span>
                <span className="block text-[12px] capitalize text-muted">{t.kind}</span>
              </span>
              <StatusBar value={t.affinity * 100} label={t.affinity.toFixed(2)} className="font-mono text-[12.5px]" />
              <span className={`text-right font-mono text-[12.5px] ${t.lift >= 0 ? "text-ok-ink" : "text-flag"}`}>{signed(t.lift)}</span>
            </li>
          ))}
        </ol>
      )}
    </CardBand>
  );
}
