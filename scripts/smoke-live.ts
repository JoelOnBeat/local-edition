/**
 * Live smoke checks for Token Factory and Tavily (never part of `npm test`).
 *
 *   npx tsx scripts/smoke-live.ts <check|all> [more checks]
 *   checks: reasoning, menu, tools, schema, embed, rerank, tavily
 *
 * Reads NEBIUS_API_KEY and TAVILY_API_KEY from .env.local (never printed). Qloo is never called. Every live
 * response is recorded to .recordings/ (gitignored). Each check prints one JSON line per call with tokens and
 * dollars, and writes .recordings/smoke-live-<check>.json. Run with SPEND_CAP_USD=1.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function loadEnv(file: string): void {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trimStart().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (process.env[k] === undefined) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local: the checks will report the missing key.
  }
}
loadEnv(resolve(process.cwd(), ".env.local"));
Object.assign(process.env, { TF_MODE: "live", TAVILY_MODE: "live", QLOO_MODE: "fixture", STORE_DRIVER: "memory" });
process.env.SPEND_CAP_USD ??= "1";

type Row = Record<string, unknown>;
const rows: Row[] = [];
const usd = (n: number) => Math.round(n * 1e6) / 1e6;

async function main() {
  const { resetEnvCache, serverEnv } = await import("@/lib/env");
  resetEnvCache();
  const env = serverEnv();
  const tfMod = await import("@/server/tokenfactory");
  const { createTokenFactory, MODELS, priceUsd } = tfMod;
  if (!env.NEBIUS_API_KEY) throw new Error("NEBIUS_API_KEY missing: run the secret store inject first.");
  const tf = createTokenFactory({ apiKey: env.NEBIUS_API_KEY, mode: "live" });
  const sample = await import("@/server/sample/chain");

  const record = (check: string, label: string, r: Row) => {
    const row = { check, label, ...r };
    rows.push(row);
    process.stdout.write(`${JSON.stringify(row)}\n`);
  };
  const cost = (model: string, u: { inTokens: number; outTokens: number }) => usd(priceUsd(model, u.inTokens, u.outTokens));
  const fail = (e: unknown) => {
    const x = e as { name?: string; code?: string; status?: number; message?: string };
    return { ok: false, error: `${x.name ?? "Error"} ${x.code ?? ""} ${x.status ?? ""}`.trim(), message: String(x.message ?? "").slice(0, 160) };
  };
  const timed = async <T>(fn: () => Promise<T>) => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };

  const checks: Record<string, () => Promise<void>> = {
    // 1. Reasoning control, through the client: tokens per setting on each model.
    async reasoning() {
      const msgs = [
        { role: "system" as const, content: "You write one-line cafe specials. No health claims." },
        { role: "user" as const, content: "Write one line (max 20 words) for a Banana Bread special at a Park Slope cafe." },
      ];
      for (const model of [MODELS.copy, MODELS.agent]) {
        for (const reasoning of ["off", "low", "default"] as const) {
          try {
            const { value: r, ms } = await timed(() => tf.chat(msgs, { model, maxTokens: 700, temperature: 0, reasoning }));
            record("reasoning", `${model} ${reasoning}`, { ok: true, ms, ...r.usage, usd: cost(model, r.usage), finish: r.finishReason, content: (r.content ?? "").slice(0, 80) });
          } catch (e) {
            record("reasoning", `${model} ${reasoning}`, fail(e));
          }
        }
      }
    },

    // 2a. Vision: the sample menu board photo against the 22 sample items.
    async menu() {
      const { readFile } = await import("node:fs/promises");
      const { readMenuBoardDetailed } = await import("@/server/tokenfactory/menu");
      const bytes = new Uint8Array(await readFile(resolve("public/sample/menu-board-photo.png")));
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const expected = sample.SAMPLE_MENU;
      try {
        const { value: r, ms } = await timed(() => readMenuBoardDetailed(bytes, "image/png", tf));
        const byName = new Map(r.items.map((i) => [norm(i.name), i]));
        const missing = expected.filter((e) => !byName.has(norm(e.name))).map((e) => e.name);
        const priceWrong = expected.flatMap((e) => {
          const got = byName.get(norm(e.name));
          return got && got.price !== e.price ? [`${e.name}: ${got.price} vs ${e.price}`] : [];
        });
        const extra = r.items.filter((i) => !expected.some((e) => norm(e.name) === norm(i.name))).map((i) => i.name);
        const catWrong = expected.flatMap((e) => {
          const got = byName.get(norm(e.name));
          return got && got.category !== e.category ? [`${e.name}: ${got.category} vs ${e.category}`] : [];
        });
        record("menu", "readMenuBoard", { ok: true, ms, mode: r.mode, count: r.items.length, expected: expected.length, missing, extra, priceWrong, catWrong });
      } catch (e) {
        record("menu", "readMenuBoard", fail(e));
      }
    },

    // 2b. Two-tool function calling round trip on the agent model.
    async tools() {
      const tools = [
        { type: "function" as const, function: { name: "block_profile", description: "Taste tags for the block around a store.", parameters: { type: "object", properties: { store: { type: "string" } }, required: ["store"] } } },
        { type: "function" as const, function: { name: "events_this_week", description: "Public events near a store this week.", parameters: { type: "object", properties: { store: { type: "string" } }, required: ["store"] } } },
      ];
      const answers: Record<string, unknown> = {
        block_profile: { tags: ["vinyl records", "indie rock", "specialty coffee"] },
        events_this_week: { events: [{ title: "Bedford Ave Record Fair", day: "Saturday" }] },
      };
      for (const reasoning of ["off", "low", "default"] as const) {
        const messages: import("openai/resources/chat/completions").ChatCompletionMessageParam[] = [
          { role: "system", content: "You plan one cafe special per store. Call every tool you need, then answer in one sentence." },
          { role: "user", content: "Plan this week for the Williamsburg store. Use both block_profile and events_this_week first." },
        ];
        let tokens = { inTokens: 0, outTokens: 0, reasoningTokens: 0 };
        const called: string[] = [];
        let finalText = "";
        const t0 = Date.now();
        try {
          for (let turn = 0; turn < 4; turn++) {
            const r = await tf.chat(messages, { model: MODELS.agent, maxTokens: 900, temperature: 0, tools, toolChoice: "auto", reasoning });
            tokens = { inTokens: tokens.inTokens + r.usage.inTokens, outTokens: tokens.outTokens + r.usage.outTokens, reasoningTokens: tokens.reasoningTokens + r.usage.reasoningTokens };
            messages.push(r.message);
            if (!r.toolCalls.length) { finalText = r.content ?? ""; break; }
            for (const c of r.toolCalls) {
              called.push(`${c.name}${c.argsError ? "(bad args)" : ""}`);
              messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(answers[c.name] ?? { error: "unknown tool" }) });
            }
          }
          record("tools", `agent ${reasoning}`, { ok: finalText !== "", ms: Date.now() - t0, called, ...tokens, usd: cost(MODELS.agent, tokens), final: finalText.slice(0, 140) });
        } catch (e) {
          record("tools", `agent ${reasoning}`, { ...fail(e), called, ...tokens });
        }
      }
    },

    // 2c. json_schema / json_object response_format per model.
    async schema() {
      const schema = { type: "object", properties: { name: { type: "string" }, price: { type: "number" } }, required: ["name", "price"], additionalProperties: false };
      const msgs = [{ role: "user" as const, content: 'Give one cafe pastry as JSON with "name" and "price" (USD).' }];
      for (const model of [MODELS.copy, MODELS.agent, MODELS.reviewer]) {
        for (const kind of ["json_schema", "json_object"] as const) {
          const responseFormat = kind === "json_schema" ? { type: "json_schema" as const, json_schema: { name: "pastry", schema, strict: true } } : { type: "json_object" as const };
          try {
            const { value: r, ms } = await timed(() => tf.chat(msgs, { model, maxTokens: 300, temperature: 0, responseFormat, reasoning: "off" }));
            let valid = false;
            try { const j = JSON.parse(r.content ?? ""); valid = typeof j.name === "string" && typeof j.price === "number"; } catch { /* not JSON */ }
            record("schema", `${model} ${kind}`, { ok: true, accepted: true, validJson: valid, ms, ...r.usage, usd: cost(model, r.usage), content: (r.content ?? "").slice(0, 80) });
          } catch (e) {
            record("schema", `${model} ${kind}`, { ...fail(e), accepted: false });
          }
        }
      }
    },

    async embed() {
      try {
        const { value: r, ms } = await timed(() => tf.embeddings(["banana bread with brown butter", "vinyl record fair on Bedford Ave"]));
        record("embed", MODELS.embedding, { ok: true, ms, count: r.vectors.length, dimension: r.vectors[0]?.length, mode: r.mode, usd: 0.000001 });
      } catch (e) {
        record("embed", MODELS.embedding, fail(e));
      }
    },

    async rerank() {
      const docs = ["A record shop with live DJ sets", "A hardware store", "An independent bookshop with a cafe"];
      try {
        const { value: r, ms } = await timed(() => tf.rawRerank("places a coffee shop could cross-promote with", docs));
        record("rerank", "rawRerank", { ok: true, available: true, ms, scores: r.scores });
      } catch (e) {
        record("rerank", "rawRerank", { ...fail(e), available: false });
      }
      try {
        const { value: r, ms } = await timed(() => tf.rerank("places a coffee shop could cross-promote with", docs));
        record("rerank", "rerank with fallback", { ok: true, ms, method: r.method, order: r.results.map((x) => x.index), mode: r.mode });
      } catch (e) {
        record("rerank", "rerank with fallback", fail(e));
      }
    },

    async tavily() {
      const { eventsThisWeek } = await import("@/server/tavily");
      for (const id of ["store_williamsburg", "store_park-slope"]) {
        const store = sample.SAMPLE_STORES.find((s) => s.id === id)!;
        try {
          const { value: r, ms } = await timed(() => eventsThisWeek(store, { city: sample.SAMPLE_CHAIN.city.name }));
          record("tavily", store.name, {
            ok: true, ms, mode: r.evidence.mode, query: r.evidence.params.query, events: r.events.length, credits: 1,
            withDate: r.events.filter((e) => e.date).length,
            sample: r.events.slice(0, 3).map((e) => ({ title: e.title.slice(0, 70), host: new URL(e.url).host, date: e.date ?? null })),
          });
        } catch (e) {
          record("tavily", store.name, fail(e));
        }
      }
    },
  };

  const wanted = process.argv.slice(2);
  const list = wanted.length === 0 || wanted.includes("all") ? Object.keys(checks) : wanted;
  for (const name of list) {
    if (!checks[name]) throw new Error(`Unknown check "${name}". Choose from: ${Object.keys(checks).join(", ")}`);
    const before = rows.length;
    await checks[name]();
    await mkdir(resolve(".recordings"), { recursive: true });
    await writeFile(resolve(`.recordings/smoke-live-${name}.json`), JSON.stringify(rows.slice(before), null, 2));
  }
  const total = rows.reduce((s, r) => s + (typeof r.usd === "number" ? r.usd : 0), 0);
  process.stdout.write(`${JSON.stringify({ summary: true, calls: rows.length, estimatedUsd: usd(total) })}\n`);
}

main().catch((e) => {
  process.stderr.write(`smoke-live failed: ${(e as Error).name}: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
