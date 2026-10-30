"use client";

import { useState } from "react";
import type { Chain, Evidence } from "@/contract";
import { Button, EvidenceChip, Input, Notice, Textarea, cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { getApi } from "@/lib/api-client";

/** Step 2: the chain's name and up to three lines of brand voice. Every edition is written, and guarded, in this voice. */

const MAX = 140;

export function VoiceStep({ chain, onSaved }: { chain: Chain; onSaved: (c: Chain) => void }) {
  const api = getApi();
  const [name, setName] = useState(chain.name);
  const [lines, setLines] = useState<string[]>(() => [...chain.brandVoice, "", "", ""].slice(0, 3));
  const [sources, setSources] = useState<Evidence[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);

  const filled = lines.map((l) => l.trim()).filter(Boolean);
  const tooLong = lines.some((l) => l.trim().length > MAX);
  const invalid = !name.trim() || name.trim().length > 80 || filled.length === 0 || tooLong;

  const draft = async () => {
    setDrafting(true);
    setMsg(null);
    try {
      const r = await api.generateBrandVoice();
      setLines([...r.lines, "", "", ""].slice(0, 3));
      setSources(r.sources);
      setMsg({ tone: "ok", text: "Drafted from your website. Edit them until they sound like you, then save." });
    } catch (e) {
      setMsg({ tone: "flag", text: (e as Error).message || "Could not read the website. Write the lines yourself." });
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.putChain({ name: name.trim(), brandVoice: filled, anchors: chain.anchors });
      onSaved(saved);
      setMsg({ tone: "ok", text: "Saved. Next week's editions use this voice, and guardrails check copy against it." });
    } catch (e) {
      setMsg({ tone: "flag", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <label className="grid max-w-md gap-2">
        <span className="text-[14px] font-medium leading-5 text-ink">Chain name</span>
        <Input data-testid="voice-chain-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-medium leading-5 text-ink">How your chain talks, in up to three lines</span>
          <Button data-testid="voice-draft" size="sm" loading={drafting} onClick={draft} icon={<Icon name="sparkles" size={14} />}>Draft from our website</Button>
        </div>
        {lines.map((l, i) => {
          const over = l.trim().length > MAX;
          return (
            <div key={i} className="grid gap-1">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white text-[12px] font-semibold text-ink-2 shadow-plate tnum">{i + 1}</span>
                <Textarea
                  rows={2} value={l} data-testid={`voice-line-${i}`} aria-label={`Brand voice line ${i + 1}`} aria-invalid={over}
                  placeholder={["Warm and plain-spoken, like the person who knows your order.", "We talk about the block, not about ourselves.", "Short sentences, no hype."][i]}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? e.target.value : x)))}
                  className="min-h-[64px] resize-y"
                />
              </div>
              <span className={cx("justify-self-end font-mono text-[12px] tnum", over ? "text-flag" : "text-muted")}>{l.trim().length}/{MAX}</span>
            </div>
          );
        })}
        <p className="text-[13px] leading-5 text-muted">Drafting reads a few pages of your site once (Tavily), then Nemotron Lightning writes the lines.</p>
      </div>

      {sources.length ? (
        <div data-testid="voice-sources" className="flex flex-wrap gap-2">{sources.map((s) => <EvidenceChip key={s.id} evidence={s} />)}</div>
      ) : null}
      {msg ? <div data-testid="voice-message" data-tone={msg.tone}><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
      <div>
        <Button data-testid="voice-save" variant="primary" size="sm" className="h-10 px-6" loading={saving} disabled={invalid} onClick={save}>Save brand voice</Button>
        {filled.length === 0 ? <span className="ml-3 text-[13px] text-flag">Write at least one line.</span> : null}
      </div>
    </div>
  );
}
