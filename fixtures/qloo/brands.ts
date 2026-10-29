/** Brand catalogue. Real public names as labels; popularity percentiles are synthetic. */

/** [slug, name, popularity 0-1, brand genre slug (urn:tag:genre:brand:*)] */
export type BrandDef = [slug: string, name: string, popularity: number, genre: string];

export const BRANDS: BrandDef[] = [
  ["blue-bottle-coffee", "Blue Bottle Coffee", 0.72, "food_and_beverage"],
  ["aesop", "Aesop", 0.6, "health_and_beauty"],
  ["muji", "Muji", 0.7, "retail"],
  ["tartine", "Tartine", 0.45, "food_and_beverage"],
  ["sightglass-coffee", "Sightglass Coffee", 0.38, "food_and_beverage"],
  ["stumptown-coffee-roasters", "Stumptown Coffee Roasters", 0.55, "food_and_beverage"],
  ["intelligentsia", "Intelligentsia Coffee", 0.5, "food_and_beverage"],
  ["la-colombe", "La Colombe", 0.62, "food_and_beverage"],
  ["joe-coffee", "Joe Coffee Company", 0.42, "food_and_beverage"],
  ["counter-culture-coffee", "Counter Culture Coffee", 0.4, "food_and_beverage"],
  ["variety-coffee-roasters", "Variety Coffee Roasters", 0.3, "food_and_beverage"],
  ["devocion", "Devocion", 0.28, "food_and_beverage"],
  ["levain-bakery", "Levain Bakery", 0.58, "food_and_beverage"],
  ["maman", "Maman", 0.52, "food_and_beverage"],
  ["van-leeuwen", "Van Leeuwen Ice Cream", 0.5, "food_and_beverage"],
  ["brooklyn-brewery", "Brooklyn Brewery", 0.5, "food_and_beverage"],
  ["sweetgreen", "Sweetgreen", 0.6, "food_and_beverage"],
  ["shake-shack", "Shake Shack", 0.82, "food_and_beverage"],
  ["russ-and-daughters", "Russ & Daughters", 0.34, "food_and_beverage"],
  ["orwashers", "Orwashers Bakery", 0.24, "food_and_beverage"],
  ["mast-chocolate", "Mast Chocolate", 0.3, "food_and_beverage"],
  ["brooklyn-roasting", "Brooklyn Roasting Company", 0.26, "food_and_beverage"],
  ["warby-parker", "Warby Parker", 0.62, "retail"],
  ["everlane", "Everlane", 0.6, "fashion"],
  ["patagonia", "Patagonia", 0.68, "fashion"],
  ["glossier", "Glossier", 0.6, "health_and_beauty"],
  ["kiehls", "Kiehl's", 0.62, "health_and_beauty"],
  ["reformation", "Reformation", 0.52, "fashion"],
];
