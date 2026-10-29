import type { StoreFixture } from "./types";

/** SYNTHETIC block data: Williamsburg, Park Slope, Astoria, Harlem. See README.md. */

export const WILLIAMSBURG: StoreFixture = {
  slug: "williamsburg",
  boosts: {
    "amb:trendy": 0.88, "amb:artsy": 0.84, "amb:bohemian": 0.74, "amb:lively": 0.72,
    "nbh:arts_district": 0.79, "nbh:nightlife": 0.7, "nbh:walkable": 0.8,
    "good:late_night": 0.66, "good:groups": 0.62,
    "cui:japanese": 0.72, "cui:korean": 0.6,
    "dish:ramen": 0.7, "dish:matcha_soft_serve": 0.62, "dish:sourdough_toast": 0.62,
    "menu:hojicha": 0.66, "menu:natural_wine": 0.7, "menu:black_sesame": 0.55, "menu:oat_milk": 0.66,
    "mus:indie_pop": 0.84, "mus:dream_pop": 0.74, "mus:electronic": 0.66,
  },
  places: [
    ["Tin Bell Records", "124 Bedford Ave, Brooklyn", "g:record_store,amb:artsy,amb:trendy,mus:indie_pop", 60, 40, 0.93, 0.45, 4.7, 0.9],
    ["The Paper Heron", "201 Bedford Ave, Brooklyn", "g:book_store,amb:cozy,amb:artsy", -40, 140, 0.9, 0.4, 4.8, 0.35],
    ["Sable & Saffron", "88 N 6th St, Brooklyn", "g:restaurant:cafe,menu:hojicha,dish:matcha_soft_serve", 110, -60, 0.88, 0.55, 4.5, 0.8],
    ["Halfmoon Bakehouse", "56 Berry St, Brooklyn", "g:restaurant:bakery,dish:sourdough_toast,dish:croissant", -120, -90, 0.86, 0.5, 4.6, 0.55],
    ["Low Tide Wine Bar", "172 N 8th St, Brooklyn", "g:restaurant:bar,menu:natural_wine,amb:intimate", 150, 120, 0.84, 0.42, 4.4, 0.85],
    ["Gallery Fenwick", "33 N 3rd St, Brooklyn", "g:art_gallery,amb:artsy,nbh:arts_district", -260, -240, 0.83, 0.3, 4.3, 0.2],
    ["Kent Street Pocket Park", "Kent St & Wythe Ave, Brooklyn", "g:park,nbh:waterfront", 520, 210, 0.74, 0.5, 4.5, 0.15],
    ["Noodle Orchard", "9 N 6th St, Brooklyn", "g:restaurant,cui:japanese,dish:ramen", 90, -150, 0.82, 0.6, 4.4, 0.45],
    ["Velvet Anchor", "40 Grand St, Brooklyn", "g:venue,amb:lively,mus:indie_pop,good:late_night", -310, 90, 0.8, 0.52, 4.2, 0.7],
    ["Kinfolk Press & Print", "75 Wythe Ave, Brooklyn", "g:boutique,amb:artsy", 230, 60, 0.76, 0.28, 4.6, 0.6],
    ["Mulberry & Rye", "150 Metropolitan Ave, Brooklyn", "g:restaurant:bar,menu:craft_cocktails,amb:trendy", -180, 310, 0.78, 0.58, 4.3, 0.4],
    ["Oak Barrel Vintage", "18 Havemeyer St, Brooklyn", "g:boutique,amb:bohemian", 340, -200, 0.72, 0.33, 4.5, 0.5],
  ],
  artists: [
    ["beach-house", 0.9, 0.5], ["men-i-trust", 0.88, 0.8], ["japanese-breakfast", 0.86, 0.55], ["alvvays", 0.82, 0.4],
    ["wet-leg", 0.8, 0.7], ["soccer-mommy", 0.78, 0.4], ["faye-webster", 0.76, 0.6], ["fazerdaze", 0.74, 0.3],
    ["hovvdy", 0.72, 0.35], ["wednesday", 0.7, 0.5], ["jamie-xx", 0.7, 0.3], ["caribou", 0.68, 0.3],
    ["four-tet", 0.66, 0.2], ["floating-points", 0.62, 0.2], ["kaytranada", 0.6, 0.5], ["earl-sweatshirt", 0.55, 0.2],
    ["overmono", 0.55, 0.6], ["cigarettes-after-sex", 0.84, 0.3],
  ],
  brands: [
    ["stumptown-coffee-roasters", 0.82], ["la-colombe", 0.78], ["brooklyn-brewery", 0.8], ["van-leeuwen", 0.76],
    ["devocion", 0.74], ["mast-chocolate", 0.7], ["variety-coffee-roasters", 0.7], ["brooklyn-roasting", 0.66],
    ["sightglass-coffee", 0.6], ["intelligentsia", 0.6], ["everlane", 0.6], ["warby-parker", 0.5],
  ],
};

export const PARK_SLOPE: StoreFixture = {
  slug: "park-slope",
  boosts: {
    "amb:family_friendly": 0.88, "amb:cozy": 0.76, "amb:quiet": 0.68,
    "nbh:residential": 0.86, "nbh:family_oriented": 0.9,
    "good:kids": 0.84, "good:brunch": 0.76, "good:catching_up": 0.66,
    "cui:italian": 0.7,
    "dish:croissant": 0.68, "dish:sourdough_toast": 0.58, "dish:bagel_with_lox": 0.6,
    "menu:cinnamon": 0.62, "menu:pastries": 0.78, "menu:brown_butter": 0.58, "menu:oat_milk": 0.64,
    "mus:folk": 0.72, "mus:indie_pop": 0.66, "mus:classical": 0.5,
  },
  places: [
    ["Little Acorn Books", "212 7th Ave, Brooklyn", "g:book_store,nbh:family_oriented,amb:cozy", 40, 60, 0.92, 0.38, 4.8, 0.3],
    ["Sunday Flour Bakery", "145 7th Ave, Brooklyn", "g:restaurant:bakery,dish:croissant,menu:pastries", -60, -80, 0.9, 0.5, 4.7, 0.6],
    ["Garfield Place Green", "Garfield Pl & 8th Ave, Brooklyn", "g:park,good:kids", -310, 150, 0.8, 0.4, 4.6, 0.2],
    ["Pebble & Pine Toys", "310 7th Ave, Brooklyn", "g:boutique,good:kids", 20, 240, 0.78, 0.25, 4.7, 0.4],
    ["Nine Lanterns Trattoria", "98 9th St, Brooklyn", "g:restaurant,cui:italian,amb:family_friendly", 80, 20, 0.86, 0.55, 4.5, 0.5],
    ["The Brass Kettle", "187 7th Ave, Brooklyn", "g:restaurant:cafe,good:catching_up,menu:cinnamon", -20, 110, 0.88, 0.45, 4.6, 0.75],
    ["Slope Street Gallery", "61 5th Ave, Brooklyn", "g:art_gallery", 380, -140, 0.7, 0.22, 4.4, 0.15],
    ["Fig & Fennel Brunch House", "224 5th Ave, Brooklyn", "g:restaurant,good:brunch,dish:sourdough_toast", 330, 90, 0.84, 0.6, 4.5, 0.45],
    ["Moss Row Wine Cellar", "104 8th Ave, Brooklyn", "g:restaurant:bar,amb:cozy", -280, -40, 0.76, 0.35, 4.4, 0.35],
    ["Cardigan Records", "46 7th Ave, Brooklyn", "g:record_store,mus:folk", 10, -260, 0.82, 0.3, 4.6, 0.7],
    ["Third Street Bagel Works", "76 3rd St, Brooklyn", "g:restaurant:bakery,dish:bagel_with_lox", 150, -420, 0.8, 0.52, 4.5, 0.25],
    ["Wren & Willow Garden Cafe", "172 Prospect Park W, Brooklyn", "g:restaurant:cafe,amb:quiet,good:working_remotely", -420, -300, 0.79, 0.38, 4.6, 0.55],
  ],
  artists: [
    ["big-thief", 0.9, 0.5], ["fleet-foxes", 0.86, 0.3], ["iron-and-wine", 0.84, 0.25], ["gregory-alan-isakov", 0.82, 0.3],
    ["adrianne-lenker", 0.8, 0.6], ["nick-drake", 0.76, 0.2], ["joni-mitchell", 0.75, 0.2], ["faye-webster", 0.74, 0.5],
    ["michael-kiwanuka", 0.74, 0.35], ["leon-bridges", 0.72, 0.4], ["esperanza-spalding", 0.7, 0.3], ["bill-evans", 0.66, 0.15],
    ["ludovico-einaudi", 0.62, 0.25], ["yo-yo-ma", 0.6, 0.1], ["hania-rani", 0.62, 0.7], ["angel-olsen", 0.6, 0.4],
    ["alvvays", 0.6, 0.3], ["khruangbin", 0.58, 0.35],
  ],
  brands: [
    ["levain-bakery", 0.82], ["maman", 0.8], ["joe-coffee", 0.76], ["orwashers", 0.74], ["counter-culture-coffee", 0.7],
    ["van-leeuwen", 0.7], ["sweetgreen", 0.66], ["blue-bottle-coffee", 0.6], ["brooklyn-brewery", 0.56], ["patagonia", 0.6],
  ],
};

export const ASTORIA: StoreFixture = {
  slug: "astoria",
  boosts: {
    "amb:casual": 0.78, "amb:bustling": 0.72, "amb:family_friendly": 0.68,
    "nbh:walkable": 0.8, "nbh:family_oriented": 0.72, "nbh:commercial": 0.64,
    "good:groups": 0.76, "good:quick_bite": 0.66, "good:catching_up": 0.7,
    "cui:greek": 0.9, "cui:middle_eastern": 0.66,
    "dish:baklava": 0.88, "dish:greek_yogurt": 0.8, "dish:falafel": 0.64, "dish:hummus": 0.66,
    "menu:honey": 0.86, "menu:pistachio": 0.8, "menu:cinnamon": 0.54, "menu:cardamom": 0.4,
    "mus:world": 0.7, "mus:latin": 0.56, "mus:electronic": 0.52,
  },
  places: [
    ["Olive Branch Bakery", "31-04 30th Ave, Queens", "g:restaurant:bakery,dish:baklava,menu:honey,menu:pistachio", 40, 30, 0.94, 0.5, 4.8, 0.55],
    ["Yia Yia's Table", "30-12 31st St, Queens", "g:restaurant,cui:greek,dish:greek_yogurt", -50, 60, 0.91, 0.58, 4.6, 0.4],
    ["Sunrise Sweets & Nuts", "32-19 Ditmars Blvd, Queens", "g:restaurant:bakery,menu:pistachio,menu:cinnamon", 190, 350, 0.87, 0.35, 4.7, 0.65],
    ["Cedar Mezze House", "29-18 31st St, Queens", "g:restaurant,cui:middle_eastern,dish:hummus,dish:falafel", 10, -120, 0.85, 0.5, 4.5, 0.5],
    ["Ditmars Photography Gallery", "35-09 Broadway, Queens", "g:art_gallery", -520, -340, 0.72, 0.2, 4.4, 0.2],
    ["Water's Edge Green", "Shore Blvd & 20th Ave, Queens", "g:park,nbh:waterfront", 640, 480, 0.78, 0.55, 4.7, 0.3],
    ["The Spice Ledger", "30-45 Steinway St, Queens", "g:boutique,menu:cardamom,menu:cinnamon", -300, 80, 0.8, 0.22, 4.8, 0.7],
    ["Blue Door Taverna", "28-24 Astoria Blvd, Queens", "g:restaurant:bar,cui:greek,amb:bustling", 260, -220, 0.82, 0.6, 4.4, 0.45],
    ["Marigold Records & Tapes", "33-02 30th Ave, Queens", "g:record_store,mus:world", -140, -40, 0.79, 0.25, 4.6, 0.6],
    ["Thirty-First Street Beer Garden", "31-18 31st St, Queens", "g:restaurant:bar,good:groups", 30, 210, 0.77, 0.62, 4.3, 0.35],
    ["Lemon & Thyme Cafe", "30-08 Newtown Ave, Queens", "g:restaurant:cafe,menu:honey", -200, -280, 0.83, 0.4, 4.6, 0.8],
    ["Studio Fifty Film Museum", "36-01 35th Ave, Queens", "g:museum", -450, 520, 0.7, 0.45, 4.6, 0.1],
  ],
  artists: [
    ["haris-alexiou", 0.9, 0.2], ["giorgos-dalaras", 0.88, 0.15], ["anna-vissi", 0.85, 0.3], ["despina-vandi", 0.84, 0.25],
    ["fairuz", 0.8, 0.2], ["cesaria-evora", 0.78, 0.15], ["mashrou-leila", 0.74, 0.6], ["khruangbin", 0.72, 0.5],
    ["bomba-estereo", 0.7, 0.45], ["celia-cruz", 0.66, 0.2], ["bonobo", 0.6, 0.3], ["fela-kuti", 0.6, 0.35],
    ["black-coffee", 0.58, 0.55], ["omar-apollo", 0.55, 0.5], ["stan-getz", 0.5, 0.1], ["jorge-ben-jor", 0.5, 0.25],
    ["nina-simone", 0.5, 0.2], ["four-tet", 0.4, 0.3],
  ],
  brands: [
    ["brooklyn-roasting", 0.66], ["brooklyn-brewery", 0.62], ["orwashers", 0.6], ["joe-coffee", 0.55], ["mast-chocolate", 0.55],
    ["russ-and-daughters", 0.5], ["la-colombe", 0.5],
  ],
};

export const HARLEM: StoreFixture = {
  slug: "harlem",
  boosts: {
    "amb:lively": 0.74, "amb:cozy": 0.7, "amb:upscale": 0.5,
    "nbh:historic": 0.88, "nbh:arts_district": 0.64, "nbh:residential": 0.66,
    "good:catching_up": 0.78, "good:groups": 0.7, "good:brunch": 0.8,
    "cui:soul_food": 0.9, "cui:caribbean": 0.74,
    "dish:cornbread": 0.84, "dish:sweet_potato_pie": 0.8, "dish:mac_and_cheese": 0.74, "dish:jerk_chicken": 0.7,
    "menu:cinnamon": 0.76, "menu:brown_butter": 0.6, "menu:honey": 0.6,
    "mus:jazz": 0.88, "mus:soul": 0.9, "mus:rnb": 0.8, "mus:hip_hop": 0.7, "mus:reggae": 0.54,
  },
  places: [
    ["Cornbread & Honey Kitchen", "2260 Frederick Douglass Blvd, New York", "g:restaurant,cui:soul_food,dish:cornbread,dish:mac_and_cheese", 40, 30, 0.94, 0.55, 4.7, 0.5],
    ["Mahalia Listening Room", "310 W 116th St, New York", "g:venue,mus:jazz,mus:soul", -90, -20, 0.92, 0.4, 4.8, 0.7],
    ["Sugar Hill Pie Company", "2312 Frederick Douglass Blvd, New York", "g:restaurant:bakery,dish:sweet_potato_pie,menu:cinnamon", 60, 120, 0.9, 0.45, 4.8, 0.6],
    ["The Gilded Page Bookshop", "2191 Adam Clayton Powell Jr Blvd, New York", "g:book_store,nbh:historic", 260, 90, 0.86, 0.3, 4.8, 0.3],
    ["Lenox Avenue Gallery", "2289 Lenox Ave, New York", "g:art_gallery,nbh:arts_district", 330, 230, 0.82, 0.22, 4.5, 0.25],
    ["Morningside Terrace Park", "Morningside Dr & W 117th St, New York", "g:park", -420, -100, 0.75, 0.5, 4.6, 0.15],
    ["Island Pot Jerk Grill", "2078 Frederick Douglass Blvd, New York", "g:restaurant,cui:caribbean,dish:jerk_chicken", -30, -180, 0.85, 0.5, 4.5, 0.55],
    ["Basement Blue Jazz Bar", "2331 Frederick Douglass Blvd, New York", "g:restaurant:bar,mus:jazz,amb:lively", 20, 280, 0.88, 0.48, 4.6, 0.8],
    ["Strivers Row Coffee Co.", "246 W 138th St, New York", "g:restaurant:cafe,amb:cozy", -160, 420, 0.8, 0.35, 4.6, 0.45],
    ["Hat & Cane Menswear", "2240 Frederick Douglass Blvd, New York", "g:boutique", 110, 60, 0.74, 0.25, 4.7, 0.4],
    ["Brownstone Brunch Club", "2123 Adam Clayton Powell Jr Blvd, New York", "g:restaurant,good:brunch,cui:soul_food", 380, -60, 0.83, 0.52, 4.5, 0.35],
    ["Harlem Stage Annex", "450 W 117th St, New York", "g:venue,nbh:arts_district", -480, 40, 0.78, 0.38, 4.6, 0.2],
  ],
  artists: [
    ["erykah-badu", 0.9, 0.3], ["jill-scott", 0.88, 0.25], ["lalah-hathaway", 0.87, 0.4], ["robert-glasper", 0.86, 0.45],
    ["kamasi-washington", 0.84, 0.5], ["mavis-staples", 0.83, 0.2], ["sharon-jones", 0.82, 0.2], ["charles-bradley", 0.8, 0.15],
    ["durand-jones", 0.78, 0.5], ["leon-bridges", 0.74, 0.4], ["sault", 0.72, 0.6], ["cleo-sol", 0.7, 0.7],
    ["gregory-porter", 0.7, 0.3], ["nubya-garcia", 0.66, 0.65], ["black-thought", 0.66, 0.3], ["noname", 0.64, 0.45],
    ["little-simz", 0.6, 0.5], ["samara-joy", 0.6, 0.6], ["toots-and-the-maytals", 0.56, 0.2], ["koffee", 0.52, 0.55],
  ],
  brands: [
    ["levain-bakery", 0.7], ["la-colombe", 0.66], ["joe-coffee", 0.6], ["brooklyn-brewery", 0.56], ["counter-culture-coffee", 0.55],
    ["sweetgreen", 0.5],
  ],
};
