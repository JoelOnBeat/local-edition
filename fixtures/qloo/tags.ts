/** Tag catalogue: city-level baseline affinity per tag. Ids are `<type urn>:<slug>`. */

export type TagRow = [slug: string, name: string, baseline: number];

export interface TagTypeDef {
  /** Short key used by store boosts ("amb:trendy"). */
  key: string;
  /** Value of `filter.tag.types`. */
  type: string;
  tags: TagRow[];
}

export const TAG_TYPES: TagTypeDef[] = [
  {
    key: "amb",
    type: "urn:tag:ambience:qloo",
    tags: [
      ["cozy", "Cozy", 0.58], ["intimate", "Intimate", 0.5], ["lively", "Lively", 0.55], ["quiet", "Quiet", 0.46],
      ["trendy", "Trendy", 0.52], ["artsy", "Artsy", 0.44], ["romantic", "Romantic", 0.4], ["casual", "Casual", 0.62],
      ["upscale", "Upscale", 0.38], ["bohemian", "Bohemian", 0.36], ["family_friendly", "Family-friendly", 0.42],
      ["bustling", "Bustling", 0.48],
    ],
  },
  {
    key: "nbh",
    type: "urn:tag:neighborhood_characteristic:qloo",
    tags: [
      ["walkable", "Walkable", 0.64], ["commercial", "Commercial", 0.5], ["residential", "Residential", 0.52],
      ["historic", "Historic", 0.4], ["nightlife", "Nightlife", 0.45], ["tourist_area", "Tourist area", 0.42],
      ["family_oriented", "Family-oriented", 0.44], ["student_area", "Student area", 0.38], ["waterfront", "Waterfront", 0.3],
      ["arts_district", "Arts district", 0.36],
    ],
  },
  {
    key: "good",
    type: "urn:tag:good_for:qloo",
    tags: [
      ["working_remotely", "Working remotely", 0.54], ["date_night", "Date night", 0.46], ["groups", "Groups", 0.5],
      ["solo", "Solo visits", 0.52], ["quick_bite", "Quick bite", 0.56], ["brunch", "Brunch", 0.5],
      ["late_night", "Late night", 0.38], ["kids", "Kids", 0.4], ["commuters", "Commuters", 0.44],
      ["catching_up", "Catching up with friends", 0.48],
    ],
  },
  {
    key: "cui",
    type: "urn:tag:cuisine:qloo",
    tags: [
      ["italian", "Italian", 0.55], ["japanese", "Japanese", 0.5], ["korean", "Korean", 0.42], ["mexican", "Mexican", 0.5],
      ["caribbean", "Caribbean", 0.3], ["middle_eastern", "Middle Eastern", 0.38], ["greek", "Greek", 0.3],
      ["soul_food", "Soul food", 0.28], ["chinese", "Chinese", 0.48], ["french", "French", 0.44],
      ["jewish_deli", "Jewish deli", 0.3], ["southeast_asian", "Southeast Asian", 0.4], ["peruvian", "Peruvian", 0.22],
    ],
  },
  {
    key: "dish",
    type: "urn:tag:specialty_dish:place",
    tags: [
      ["baklava", "Baklava", 0.24], ["greek_yogurt", "Greek yogurt", 0.26], ["falafel", "Falafel", 0.34], ["hummus", "Hummus", 0.36],
      ["ramen", "Ramen", 0.42], ["dumplings", "Dumplings", 0.4], ["bagel_with_lox", "Bagel with lox", 0.38],
      ["pastrami_sandwich", "Pastrami sandwich", 0.3], ["jerk_chicken", "Jerk chicken", 0.22], ["mac_and_cheese", "Mac and cheese", 0.3],
      ["cornbread", "Cornbread", 0.2], ["sweet_potato_pie", "Sweet potato pie", 0.18], ["croissant", "Croissant", 0.46],
      ["sourdough_toast", "Sourdough toast", 0.4], ["matcha_soft_serve", "Matcha soft serve", 0.24], ["tiramisu", "Tiramisu", 0.28],
      ["cannoli", "Cannoli", 0.26], ["pierogi", "Pierogi", 0.2], ["empanadas", "Empanadas", 0.24], ["tacos", "Tacos", 0.46],
    ],
  },
  {
    key: "menu",
    type: "urn:tag:menu_highlight:qloo",
    tags: [
      ["pistachio", "Pistachio", 0.26], ["cardamom", "Cardamom", 0.22], ["honey", "Honey", 0.34], ["cinnamon", "Cinnamon", 0.36],
      ["miso_caramel", "Miso caramel", 0.2], ["black_sesame", "Black sesame", 0.18], ["ginger", "Ginger", 0.32],
      ["brown_butter", "Brown butter", 0.3], ["lavender", "Lavender", 0.22], ["hojicha", "Hojicha", 0.2],
      ["dulce_de_leche", "Dulce de leche", 0.22], ["pastries", "Pastries", 0.54], ["cold_brew", "Cold brew", 0.5],
      ["natural_wine", "Natural wine", 0.28], ["oat_milk", "Oat milk", 0.42], ["craft_cocktails", "Craft cocktails", 0.36],
    ],
  },
  {
    key: "mus",
    type: "urn:tag:genre:music",
    tags: [
      ["indie_pop", "Indie pop", 0.5], ["soul", "Soul", 0.42], ["jazz", "Jazz", 0.38], ["ambient", "Ambient", 0.3],
      ["latin", "Latin", 0.4], ["hip_hop", "Hip-hop", 0.48], ["bossa_nova", "Bossa nova", 0.22], ["folk", "Folk", 0.34],
      ["electronic", "Electronic", 0.4], ["classical", "Classical", 0.28], ["reggae", "Reggae", 0.24], ["afrobeats", "Afrobeats", 0.3],
      ["rnb", "R&B", 0.46], ["dream_pop", "Dream pop", 0.3], ["salsa", "Salsa", 0.24], ["world", "World", 0.26],
    ],
  },
];

/** Place genre tags (`urn:tag:genre:place:*`); `partner` ones are the categories a partner search filters on. */
export const PLACE_GENRES: Record<string, string> = {
  restaurant: "Restaurant",
  "restaurant:bakery": "Bakery",
  "restaurant:cafe": "Cafe",
  "restaurant:bar": "Bar",
  art_gallery: "Art gallery",
  museum: "Museum",
  park: "Park",
  // Not in the published taxonomy; the real names are an open question until a key exists.
  book_store: "Bookstore",
  record_store: "Record store",
  boutique: "Boutique",
  venue: "Music venue",
};

export const PLACE_GENRE_PREFIX = "urn:tag:genre:place:";

/** Resolve a row tag ("g:restaurant:cafe", "cui:greek") to a documented tag object. */
export function resolveRowTag(code: string): { id: string; name: string; type: string } | undefined {
  const [key, ...rest] = code.split(":");
  const slug = rest.join(":");
  if (key === "g") {
    const name = PLACE_GENRES[slug];
    return name ? { id: `${PLACE_GENRE_PREFIX}${slug}`, name, type: "urn:tag:genre:place" } : undefined;
  }
  const def = TAG_TYPES.find((t) => t.key === key);
  const row = def?.tags.find((t) => t[0] === slug);
  return def && row ? { id: `${def.type}:${slug}`, name: row[1], type: def.type } : undefined;
}
