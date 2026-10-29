import type { Chain, MenuItem, QlooEntityRef, Store } from "@/contract";

/**
 * The canonical sample chain. Never a real customer. Anchor entity ids are sample placeholders:
 * the Qloo stream resolves the brand names to real entity ids at search time.
 */

export const SAMPLE_CHAIN_ID = "chain_kettle_kiln";
export const SAMPLE_CITY = { name: "New York", lat: 40.7306, lon: -73.9866 } as const;

export const SAMPLE_ANCHORS: QlooEntityRef[] = [
  { entityId: "sample-blue-bottle-coffee", name: "Blue Bottle Coffee", type: "urn:entity:brand" },
  { entityId: "sample-aesop", name: "Aesop", type: "urn:entity:brand" },
  { entityId: "sample-muji", name: "Muji", type: "urn:entity:brand" },
];

export const SAMPLE_CHAIN: Chain = {
  id: SAMPLE_CHAIN_ID,
  name: "Kettle & Kiln (sample chain)",
  category: "coffee",
  brandVoice: [
    "Warm and plain-spoken, like the person who knows your order.",
    "Neighbourly first: we talk about the block, not about ourselves.",
    "Short sentences, no hype, no exclamation marks.",
  ],
  anchors: SAMPLE_ANCHORS,
  city: { ...SAMPLE_CITY },
  isSample: true,
};

const store = (n: number, slug: string, name: string, addressLabel: string, lat: number, lon: number): Store => ({
  id: `store_${slug}`,
  chainId: SAMPLE_CHAIN_ID,
  name,
  addressLabel,
  lat,
  lon,
  colorIndex: n,
});

export const SAMPLE_STORES: Store[] = [
  store(1, "williamsburg", "Williamsburg", "Bedford Ave & N 7th St", 40.7175, -73.9573),
  store(2, "park-slope", "Park Slope", "7th Ave & 9th St", 40.6683, -73.9806),
  store(3, "astoria", "Astoria", "30th Ave & 31st St", 40.7677, -73.9217),
  store(4, "harlem", "Harlem", "Frederick Douglass Blvd & W 116th St", 40.8037, -73.9555),
  store(5, "west-village", "West Village", "Bleecker St & Christopher St", 40.7333, -74.0036),
  store(6, "lower-east-side", "Lower East Side", "Orchard St & Rivington St", 40.7205, -73.9893),
  store(7, "upper-east-side", "Upper East Side", "Lexington Ave & E 78th St", 40.7741, -73.9567),
  store(8, "long-island-city", "Long Island City", "Vernon Blvd & 48th Ave", 40.7446, -73.9534),
];

const item = (
  slug: string,
  name: string,
  category: MenuItem["category"],
  price: number,
  description: string,
): MenuItem => ({ id: `menu_${slug}`, name, category, price, currency: "USD", description, source: "manual" });

export const SAMPLE_MENU: MenuItem[] = [
  item("espresso", "Espresso", "coffee", 3.5, "Double shot of our house blend, pulled short."),
  item("cortado", "Cortado", "coffee", 4.75, "Equal parts espresso and steamed milk, served in a small glass."),
  item("flat-white", "Flat White", "coffee", 5.25, "Two ristretto shots under a thin layer of silky milk."),
  item("latte", "Latte", "coffee", 5.5, "Espresso with steamed milk and a light cap of foam."),
  item("drip", "Batch Brew", "coffee", 3.75, "Fresh filter coffee, a single origin that changes weekly."),
  item("pour-over", "Pour Over", "coffee", 6.25, "Single origin brewed by hand, one cup at a time."),
  item("mocha", "Mocha", "coffee", 6.0, "Espresso, steamed milk and house-made dark chocolate sauce."),
  item("cold-brew", "Cold Brew", "cold", 5.0, "Steeped for eighteen hours, served over ice."),
  item("iced-latte", "Iced Latte", "cold", 5.75, "Espresso poured over cold milk and ice."),
  item("nitro", "Nitro Cold Brew", "cold", 6.0, "Cold brew on tap with a creamy, cascading head."),
  item("lemonade", "Sparkling Lemonade", "cold", 4.5, "Fresh lemon, cane sugar and soda water."),
  item("chai", "Masala Chai", "tea", 5.0, "Black tea simmered with ginger, cardamom and cinnamon, finished with milk."),
  item("matcha", "Matcha Latte", "tea", 6.0, "Ceremonial-grade matcha whisked with steamed milk."),
  item("hojicha", "Hojicha", "tea", 4.75, "Roasted green tea with a toasty, caramel finish."),
  item("croissant", "Butter Croissant", "bakery", 4.25, "Laminated daily, baked until deep gold."),
  item("almond-croissant", "Almond Croissant", "bakery", 5.25, "Filled with frangipane and topped with toasted almonds."),
  item("banana-bread", "Banana Bread", "bakery", 4.5, "Thick slice with brown butter and a pinch of sea salt."),
  item("cookie", "Brown Butter Cookie", "bakery", 3.75, "Chewy centre, crisp edge, flaky salt on top."),
  item("morning-bun", "Cardamom Morning Bun", "bakery", 5.0, "Rolled with cardamom sugar and baked in a muffin tin."),
  item("avocado-toast", "Avocado Toast", "food", 11.5, "Sourdough, smashed avocado, chili flakes and lemon."),
  item("egg-sandwich", "Egg and Cheddar Sandwich", "food", 9.75, "Soft scrambled egg and sharp cheddar on a toasted brioche roll."),
  item("granola", "Yogurt and Granola Cup", "food", 7.5, "Greek yogurt, house granola and seasonal fruit."),
];

export function sampleSeed() {
  return {
    chain: structuredClone(SAMPLE_CHAIN),
    stores: structuredClone(SAMPLE_STORES),
    menu: structuredClone(SAMPLE_MENU),
  };
}
