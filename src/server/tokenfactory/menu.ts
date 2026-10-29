import type { MenuItem } from "@/contract";
import { HttpError, UpstreamError } from "../http/errors";
import { getTokenFactory, MODELS, type TfMode, type TokenFactory } from "./client";
import { jsonOutput } from "./json";
import { applyVerify, toMenuItems, VerifyOut, VlMenu } from "./menu-parse";
import { priceUsd } from "./spend";
import { createLogger } from "../log";

const log = createLogger("menu");

export type MenuMime = "image/jpeg" | "image/png" | "image/webp";

const SYSTEM = [
  "You transcribe printed or handwritten cafe, restaurant and gym-cafe menu boards.",
  "Output JSON only.",
].join(" ");

const INSTRUCTIONS = [
  "Extract every distinct menu item visible in the image.",
  'Return {"items":[{"name","category","price","currency","description","confidence"}],"unreadable_regions":[]}.',
  "Rules:",
  "- Copy item names exactly as written, without prices or footnote marks.",
  "- category is the board heading the item sits under (for example Coffee, Tea, Bakery, Toast); null if none.",
  "- price is a plain number (4.5) or null. Never guess a price. If there are several sizes, use the smallest size price.",
  "- currency is the 3-letter code if a symbol is visible (USD for $), otherwise null.",
  "- description is the short text printed under the item, or null. Do not write your own.",
  "- Leave out any dietary, allergen, nutrition or health symbols and wording (V, GF, vegan, calories and similar).",
  "- confidence is 0 to 1: how sure you are you read the item correctly.",
  "- List each item once. Skip logos, opening hours, addresses and slogans.",
  "- Put regions you could not read in unreadable_regions.",
].join("\n");

/** base64 without Buffer (Workers-safe), chunked to stay under argument limits. */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** One model call, for the run panel's `step_metrics` (role `vision`). */
export interface MenuStep {
  tool: "menu_extract" | "menu_verify";
  model: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  usd: number;
}

export interface MenuRead {
  items: MenuItem[];
  mode: TfMode;
  /** `verified` when the second pass ran; `skipped` when it was off, offline or failed (items then carry no flags). */
  verify: "verified" | "skipped";
  /** Rows the verify pass could not find on the photo and removed. */
  dropped: number;
  steps: MenuStep[];
}

const VERIFY_SYSTEM = "You check a transcription of a menu board against the photo of the board. Output JSON only.";

const VERIFY_RULES = [
  'Return {"rows":[{"i":number,"seen":boolean,"price_legible":boolean}]} with exactly one row per input row, using its "i".',
  "- seen: true only if that item's name is actually printed on the board in the photo. False if it is not there.",
  "- price_legible: true only if the item's price is clearly readable in the photo and equals the transcribed price. False if the price is blurred, cut off, hidden by glare, unclear, missing, or different from the transcription.",
  "Do not correct or add rows.",
].join("\n");

const dataUrl = (bytes: Uint8Array, mime: MenuMime) => ({ type: "image_url" as const, image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } });

/** Photo of a menu board -> MenuItem[]: Super VL reads it, then a second Super VL call checks each row against the same photo. */
export async function readMenuBoardDetailed(
  bytes: Uint8Array,
  mime: MenuMime,
  tf: TokenFactory = getTokenFactory(),
  opts: { verify?: boolean } = {},
): Promise<MenuRead> {
  const steps: MenuStep[] = [];
  const t0 = Date.now();
  const r = await jsonOutput(VlMenu, {
    tf,
    model: MODELS.vision,
    repairModel: MODELS.copy,
    name: "menu",
    maxTokens: 6000,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: [dataUrl(bytes, mime), { type: "text", text: INSTRUCTIONS }] },
    ],
  });
  steps.push({ tool: "menu_extract", model: MODELS.vision, ms: Date.now() - t0, promptTokens: r.usage.inTokens, completionTokens: r.usage.outTokens, usd: priceUsd(MODELS.vision, r.usage.inTokens, r.usage.outTokens) });
  const extracted = toMenuItems(r.data);
  if (extracted.length === 0) {
    throw new HttpError(422, "no_menu_items", "No menu items could be read from this photo. Try a straighter, brighter shot of the board.");
  }
  // The built-in fixture board cannot answer a verify prompt, so offline runs skip it.
  if (opts.verify === false || tf.mode === "fixture") return { items: extracted, mode: r.mode, verify: "skipped", dropped: 0, steps };
  return { ...(await verifyRows(tf, bytes, mime, extracted, steps)), mode: r.mode, steps };
}

async function verifyRows(tf: TokenFactory, bytes: Uint8Array, mime: MenuMime, extracted: MenuItem[], steps: MenuStep[]) {
  const skipped = { items: extracted, verify: "skipped" as const, dropped: 0 };
  const rows = extracted.map((m, i) => ({ i, name: m.name, price: m.price }));
  const t1 = Date.now();
  try {
    const v = await jsonOutput(VerifyOut, {
      tf,
      model: MODELS.vision,
      repairModel: MODELS.copy,
      name: "menu_verify",
      maxTokens: 3000,
      temperature: 0,
      messages: [
        { role: "system", content: VERIFY_SYSTEM },
        { role: "user", content: [dataUrl(bytes, mime), { type: "text", text: `${VERIFY_RULES}\n\nTranscription:\n${JSON.stringify(rows)}` }] },
      ],
    });
    steps.push({ tool: "menu_verify", model: MODELS.vision, ms: Date.now() - t1, promptTokens: v.usage.inTokens, completionTokens: v.usage.outTokens, usd: priceUsd(MODELS.vision, v.usage.inTokens, v.usage.outTokens) });
    const applied = applyVerify(extracted, v.data);
    // A verifier that sees nothing is broken, not right: keep the first read rather than empty the menu.
    if (applied.items.length === 0) return skipped;
    return { ...applied, verify: "verified" as const };
  } catch (e) {
    // The photo was already read and paid for; a failed or rate-limited check must not lose it. Only the spend cap speaks.
    if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
    log.warn("menu verify pass failed; keeping the first read", { code: e instanceof UpstreamError ? e.code : "error" });
    return skipped;
  }
}

export async function readMenuBoard(bytes: Uint8Array, mime: MenuMime, tf?: TokenFactory): Promise<MenuItem[]> {
  return (await readMenuBoardDetailed(bytes, mime, tf)).items;
}
