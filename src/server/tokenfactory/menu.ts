import type { MenuItem } from "@/contract";
import { HttpError } from "../http/errors";
import { getTokenFactory, MODELS, type TfMode, type TokenFactory } from "./client";
import { jsonOutput } from "./json";
import { toMenuItems, VlMenu } from "./menu-parse";

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

export interface MenuRead {
  items: MenuItem[];
  mode: TfMode;
}

/** Photo of a menu board -> MenuItem[] via Nemotron 3.5 Super VL, validated with zod. */
export async function readMenuBoardDetailed(bytes: Uint8Array, mime: MenuMime, tf: TokenFactory = getTokenFactory()): Promise<MenuRead> {
  const r = await jsonOutput(VlMenu, {
    tf,
    model: MODELS.vision,
    repairModel: MODELS.copy,
    name: "menu",
    maxTokens: 6000,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } },
          { type: "text", text: INSTRUCTIONS },
        ],
      },
    ],
  });
  const items = toMenuItems(r.data);
  if (items.length === 0) {
    throw new HttpError(422, "no_menu_items", "No menu items could be read from this photo. Try a straighter, brighter shot of the board.");
  }
  return { items, mode: r.mode };
}

export async function readMenuBoard(bytes: Uint8Array, mime: MenuMime, tf?: TokenFactory): Promise<MenuItem[]> {
  return (await readMenuBoardDetailed(bytes, mime, tf)).items;
}
