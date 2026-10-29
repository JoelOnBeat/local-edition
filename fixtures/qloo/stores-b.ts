import type { StoreFixture } from "./types";

/** SYNTHETIC block data: West Village, Lower East Side, Upper East Side, Long Island City. See README.md. */

export const WEST_VILLAGE: StoreFixture = {
  slug: "west-village",
  boosts: {
    "amb:intimate": 0.9, "amb:romantic": 0.84, "amb:cozy": 0.8, "amb:upscale": 0.62,
    "nbh:historic": 0.84, "nbh:walkable": 0.88, "nbh:tourist_area": 0.6,
    "good:date_night": 0.86, "good:catching_up": 0.72, "good:solo": 0.66,
    "cui:french": 0.78, "cui:italian": 0.78,
    "dish:tiramisu": 0.72, "dish:croissant": 0.74, "dish:cannoli": 0.6,
    "menu:lavender": 0.58, "menu:pastries": 0.72, "menu:craft_cocktails": 0.7,
    "mus:jazz": 0.86, "mus:bossa_nova": 0.66, "mus:classical": 0.6, "mus:soul": 0.56,
  },
  places: [
    ["Rue Mallard Patisserie", "114 Christopher St, New York", "g:restaurant:bakery,cui:french,dish:croissant", 40, 30, 0.94, 0.5, 4.8, 0.55],
    ["Candlewick Wine Room", "60 Bleecker St, New York", "g:restaurant:bar,amb:intimate,amb:romantic", -60, 50, 0.9, 0.42, 4.6, 0.7],
    ["Grove Court Books", "22 Grove St, New York", "g:book_store,nbh:historic", 90, 90, 0.88, 0.3, 4.8, 0.25],
    ["Piazza Fiore", "151 Bleecker St, New York", "g:restaurant,cui:italian,dish:tiramisu,dish:cannoli", 200, -30, 0.87, 0.6, 4.5, 0.4],
    ["The Jazz Cellar at Barrow", "17 Barrow St, New York", "g:venue,mus:jazz,amb:intimate", -110, 130, 0.9, 0.45, 4.7, 0.8],
    ["Christopher Pier Green", "Christopher St Pier, New York", "g:park,nbh:waterfront", -520, 20, 0.76, 0.55, 4.7, 0.15],
    ["Gallery Seventy-Five", "75 Greenwich Ave, New York", "g:art_gallery", 140, 210, 0.78, 0.25, 4.4, 0.2],
    ["Lavender & Lace", "88 Christopher St, New York", "g:boutique,menu:lavender", 70, -20, 0.8, 0.22, 4.7, 0.5],
    ["Monk's Corner Cafe", "9 Bedford St, New York", "g:restaurant:cafe,amb:cozy", 150, -110, 0.84, 0.38, 4.6, 0.6],
    ["Sixth Avenue Cannoli Shop", "312 Bleecker St, New York", "g:restaurant:bakery,dish:cannoli", -230, 40, 0.82, 0.48, 4.5, 0.3],
    ["Washington Square Tea House", "1 Waverly Pl, New York", "g:restaurant:cafe,amb:quiet", 410, 190, 0.79, 0.4, 4.5, 0.35],
    ["Perry Street Cinema Club", "54 Perry St, New York", "g:venue,amb:intimate", -180, 160, 0.77, 0.33, 4.6, 0.45],
  ],
  artists: [
    ["chet-baker", 0.9, 0.2], ["bill-evans", 0.88, 0.15], ["samara-joy", 0.86, 0.7], ["gregory-porter", 0.84, 0.35],
    ["ahmad-jamal", 0.82, 0.25], ["nina-simone", 0.8, 0.3], ["stan-getz", 0.78, 0.2], ["astrud-gilberto", 0.78, 0.3],
    ["joao-gilberto", 0.76, 0.2], ["antonio-carlos-jobim", 0.74, 0.25], ["esperanza-spalding", 0.72, 0.4],
    ["nick-drake", 0.66, 0.25], ["erik-satie", 0.66, 0.15], ["max-richter", 0.62, 0.35], ["lianne-la-havas", 0.6, 0.4],
    ["cleo-sol", 0.58, 0.65], ["nubya-garcia", 0.56, 0.7],
  ],
  brands: [
    ["maman", 0.84], ["la-colombe", 0.8], ["tartine", 0.78], ["blue-bottle-coffee", 0.76], ["levain-bakery", 0.72],
    ["stumptown-coffee-roasters", 0.7], ["aesop", 0.7], ["intelligentsia", 0.64], ["reformation", 0.6], ["everlane", 0.5],
  ],
};

export const LOWER_EAST_SIDE: StoreFixture = {
  slug: "lower-east-side",
  boosts: {
    "amb:lively": 0.86, "amb:trendy": 0.8, "amb:bustling": 0.82,
    "nbh:nightlife": 0.9, "nbh:tourist_area": 0.56, "nbh:arts_district": 0.66,
    "good:late_night": 0.88, "good:groups": 0.78,
    "cui:jewish_deli": 0.72, "cui:chinese": 0.66, "cui:mexican": 0.66,
    "dish:pastrami_sandwich": 0.78, "dish:dumplings": 0.72, "dish:tacos": 0.66, "dish:bagel_with_lox": 0.66,
    "menu:craft_cocktails": 0.78, "menu:cold_brew": 0.72, "menu:ginger": 0.56, "menu:miso_caramel": 0.52,
    "mus:electronic": 0.78, "mus:hip_hop": 0.7, "mus:indie_pop": 0.66,
  },
  places: [
    ["Ludlow Pickle & Pastrami", "142 Ludlow St, New York", "g:restaurant,cui:jewish_deli,dish:pastrami_sandwich", 60, 30, 0.93, 0.55, 4.6, 0.5],
    ["Basement Static", "88 Orchard St, New York", "g:venue,mus:electronic,good:late_night", -40, -70, 0.92, 0.45, 4.4, 0.85],
    ["Rivington Dumpling Counter", "130 Rivington St, New York", "g:restaurant,cui:chinese,dish:dumplings", 90, 60, 0.88, 0.5, 4.5, 0.4],
    ["Two A.M. Tacos", "27 Clinton St, New York", "g:restaurant,cui:mexican,dish:tacos,good:late_night", 180, -20, 0.86, 0.52, 4.4, 0.7],
    ["The Copper Lantern", "47 E Houston St, New York", "g:restaurant:bar,menu:craft_cocktails,amb:trendy", -210, 220, 0.85, 0.58, 4.3, 0.6],
    ["Orchard Row Gallery", "103 Orchard St, New York", "g:art_gallery,nbh:arts_district", 20, -150, 0.8, 0.28, 4.3, 0.3],
    ["Hester Street Heritage Museum", "97 Orchard St, New York", "g:museum,nbh:historic", 10, -120, 0.78, 0.5, 4.6, 0.1],
    ["Spindle Vintage", "63 Stanton St, New York", "g:boutique", 150, 90, 0.76, 0.27, 4.5, 0.55],
    ["Allen & Ginger Cold Brew Bar", "164 Allen St, New York", "g:restaurant:cafe,menu:cold_brew,menu:ginger", 220, 110, 0.83, 0.42, 4.6, 0.9],
    ["Stanton Social Hall", "99 Stanton St, New York", "g:venue,amb:lively", 300, 70, 0.79, 0.4, 4.2, 0.45],
    ["Seward Green", "Canal St & Essex St, New York", "g:park", -170, -330, 0.7, 0.4, 4.4, 0.1],
    ["Bialy & Bean", "35 Essex St, New York", "g:restaurant:bakery,dish:bagel_with_lox", 70, -30, 0.81, 0.46, 4.5, 0.35],
  ],
  artists: [
    ["kaytranada", 0.88, 0.5], ["bicep", 0.86, 0.45], ["overmono", 0.86, 0.8], ["floating-points", 0.8, 0.3],
    ["jungle", 0.78, 0.35], ["four-tet", 0.78, 0.25], ["black-coffee", 0.7, 0.5], ["little-simz", 0.76, 0.5],
    ["earl-sweatshirt", 0.74, 0.35], ["mike", 0.72, 0.7], ["billy-woods", 0.7, 0.75], ["noname", 0.66, 0.4],
    ["black-thought", 0.64, 0.3], ["joey-badass", 0.62, 0.3], ["wet-leg", 0.6, 0.6], ["mon-laferte", 0.5, 0.3],
    ["omar-apollo", 0.56, 0.45], ["sault", 0.6, 0.5],
  ],
  brands: [
    ["russ-and-daughters", 0.86], ["la-colombe", 0.72], ["devocion", 0.7], ["mast-chocolate", 0.66], ["van-leeuwen", 0.64],
    ["brooklyn-roasting", 0.6], ["brooklyn-brewery", 0.6], ["stumptown-coffee-roasters", 0.6],
  ],
};

export const UPPER_EAST_SIDE: StoreFixture = {
  slug: "upper-east-side",
  boosts: {
    "amb:quiet": 0.84, "amb:upscale": 0.86, "amb:cozy": 0.62,
    "nbh:residential": 0.88, "nbh:family_oriented": 0.64,
    "good:solo": 0.74, "good:catching_up": 0.74, "good:brunch": 0.72, "good:quick_bite": 0.66,
    "cui:french": 0.74, "cui:italian": 0.7, "cui:japanese": 0.6,
    "dish:croissant": 0.78, "dish:tiramisu": 0.62, "dish:sourdough_toast": 0.52,
    "menu:pastries": 0.86, "menu:brown_butter": 0.66, "menu:lavender": 0.56, "menu:honey": 0.5,
    "mus:classical": 0.84, "mus:jazz": 0.66, "mus:folk": 0.6, "mus:bossa_nova": 0.55,
  },
  places: [
    ["Maison Lenox Patisserie", "1182 Lexington Ave, New York", "g:restaurant:bakery,cui:french,menu:pastries,dish:croissant", 40, 20, 0.94, 0.5, 4.8, 0.45],
    ["The Gilt Salon Tea Room", "1201 Lexington Ave, New York", "g:restaurant:cafe,amb:upscale,amb:quiet", -30, 80, 0.9, 0.38, 4.7, 0.3],
    ["Carnegie Hill Books", "1171 Lexington Ave, New York", "g:book_store,nbh:residential", 50, -60, 0.88, 0.3, 4.8, 0.2],
    ["Trattoria Alba", "1195 Lexington Ave, New York", "g:restaurant,cui:italian,dish:tiramisu", 20, 50, 0.86, 0.55, 4.6, 0.4],
    ["Gallery Park Avenue East", "1008 Park Ave, New York", "g:art_gallery,amb:upscale", -420, 30, 0.84, 0.28, 4.5, 0.2],
    ["Fifth Avenue Textile Museum", "1040 Fifth Ave, New York", "g:museum", -820, 90, 0.8, 0.6, 4.7, 0.15],
    ["East End Promenade Park", "East End Ave & E 80th St, New York", "g:park,nbh:waterfront", 760, 130, 0.77, 0.45, 4.7, 0.1],
    ["Sushi Hanami", "1230 Second Ave, New York", "g:restaurant,cui:japanese,amb:quiet", 330, 170, 0.82, 0.5, 4.6, 0.5],
    ["Madison Lavender Chocolatier", "1150 Madison Ave, New York", "g:boutique,menu:lavender", -520, -110, 0.8, 0.3, 4.8, 0.55],
    ["The Quiet Reading Room Cafe", "1215 Third Ave, New York", "g:restaurant:cafe,good:solo,amb:quiet", 230, -40, 0.85, 0.34, 4.7, 0.35],
    ["Lexington Piano Bar", "1166 Lexington Ave, New York", "g:restaurant:bar,mus:jazz,amb:upscale", 60, -110, 0.79, 0.4, 4.5, 0.25],
    ["Yorkville Brown Butter Bakery", "1305 Second Ave, New York", "g:restaurant:bakery,menu:brown_butter", 400, 260, 0.83, 0.42, 4.7, 0.6],
  ],
  artists: [
    ["max-richter", 0.9, 0.4], ["nils-frahm", 0.88, 0.35], ["olafur-arnalds", 0.86, 0.3], ["ludovico-einaudi", 0.84, 0.3],
    ["hania-rani", 0.84, 0.75], ["erik-satie", 0.8, 0.1], ["yo-yo-ma", 0.78, 0.15], ["bill-evans", 0.74, 0.15],
    ["chet-baker", 0.72, 0.15], ["antonio-carlos-jobim", 0.7, 0.2], ["joni-mitchell", 0.68, 0.2], ["nick-drake", 0.66, 0.25],
    ["gregory-porter", 0.64, 0.3], ["esperanza-spalding", 0.62, 0.35], ["michael-kiwanuka", 0.56, 0.3], ["iron-and-wine", 0.56, 0.2],
  ],
  brands: [
    ["maman", 0.8], ["tartine", 0.74], ["blue-bottle-coffee", 0.72], ["la-colombe", 0.7], ["levain-bakery", 0.66],
    ["joe-coffee", 0.64], ["kiehls", 0.6], ["aesop", 0.6], ["muji", 0.5],
  ],
};

export const LONG_ISLAND_CITY: StoreFixture = {
  slug: "long-island-city",
  boosts: {
    "amb:casual": 0.72, "amb:lively": 0.56,
    "nbh:waterfront": 0.84, "nbh:commercial": 0.72, "nbh:walkable": 0.56, "nbh:residential": 0.64,
    "good:commuters": 0.88, "good:working_remotely": 0.78, "good:quick_bite": 0.72,
    "cui:korean": 0.66, "cui:peruvian": 0.62, "cui:mexican": 0.6,
    "dish:empanadas": 0.54, "dish:tacos": 0.6, "dish:dumplings": 0.54,
    "menu:cold_brew": 0.8, "menu:oat_milk": 0.74, "menu:ginger": 0.5, "menu:pistachio": 0.4,
    "mus:electronic": 0.72, "mus:indie_pop": 0.62, "mus:afrobeats": 0.56, "mus:hip_hop": 0.52,
  },
  places: [
    ["Anable Basin Green", "Center Blvd & 46th Ave, Queens", "g:park,nbh:waterfront", 150, -60, 0.9, 0.5, 4.7, 0.2],
    ["Slipway Coffee Roasters", "47-12 Vernon Blvd, Queens", "g:restaurant:cafe,menu:cold_brew,good:commuters", 40, 30, 0.93, 0.42, 4.7, 0.75],
    ["Empanada Dock", "48-02 Vernon Blvd, Queens", "g:restaurant,dish:empanadas,cui:peruvian", -20, -20, 0.87, 0.4, 4.5, 0.5],
    ["Seoul Ferry Kitchen", "49-10 Vernon Blvd, Queens", "g:restaurant,cui:korean,dish:dumplings", -60, 110, 0.86, 0.45, 4.5, 0.6],
    ["Vernon Boulevard Books", "46-30 Vernon Blvd, Queens", "g:book_store", 70, -200, 0.82, 0.25, 4.8, 0.3],
    ["Warehouse Nine Gallery", "11-02 Jackson Ave, Queens", "g:art_gallery,nbh:arts_district", 300, 160, 0.8, 0.3, 4.4, 0.4],
    ["Court Square Taproom", "45-02 23rd St, Queens", "g:restaurant:bar,good:groups", 640, 40, 0.77, 0.5, 4.3, 0.35],
    ["Sunnyside Yard Bakery", "47-30 Center Blvd, Queens", "g:restaurant:bakery,menu:pistachio", 180, 10, 0.84, 0.38, 4.6, 0.55],
    ["Skyline Rooftop Social", "10-50 Jackson Ave, Queens", "g:restaurant:bar,amb:casual", 330, 230, 0.78, 0.55, 4.2, 0.8],
    ["Hunters Point Cowork Cafe", "48-18 Vernon Blvd, Queens", "g:restaurant:cafe,good:working_remotely", -40, 70, 0.85, 0.36, 4.6, 0.65],
    ["Museum of Industrial Design Queens", "44-02 11th St, Queens", "g:museum", 520, -180, 0.74, 0.35, 4.6, 0.1],
    ["Taqueria Cinco", "5-14 51st Ave, Queens", "g:restaurant,cui:mexican,dish:tacos", 280, 200, 0.8, 0.46, 4.4, 0.45],
  ],
  artists: [
    ["bonobo", 0.86, 0.3], ["jamie-xx", 0.84, 0.3], ["caribou", 0.82, 0.3], ["four-tet", 0.8, 0.25], ["black-coffee", 0.78, 0.5],
    ["tems", 0.76, 0.6], ["ayra-starr", 0.75, 0.7], ["asake", 0.72, 0.65], ["kaytranada", 0.7, 0.45], ["khruangbin", 0.7, 0.4],
    ["men-i-trust", 0.66, 0.7], ["jungle", 0.66, 0.35], ["japanese-breakfast", 0.6, 0.4], ["omar-apollo", 0.6, 0.5],
    ["fela-kuti", 0.56, 0.3], ["bicep", 0.6, 0.4],
  ],
  brands: [
    ["sweetgreen", 0.7], ["joe-coffee", 0.66], ["counter-culture-coffee", 0.64], ["devocion", 0.6], ["variety-coffee-roasters", 0.6],
    ["blue-bottle-coffee", 0.6], ["la-colombe", 0.6], ["muji", 0.5], ["warby-parker", 0.5],
  ],
};
