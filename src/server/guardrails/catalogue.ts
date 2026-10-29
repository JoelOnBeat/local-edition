/**
 * TypeScript mirror of guardrails/localedition/catalogue.py (the Python file is the source of truth).
 * A vitest test runs the Python file and fails if a rule, pattern, reason or match result differs.
 * Pattern syntax is the subset shared by Python `re` and JavaScript RegExp, case-insensitive.
 */

export const CATALOGUE_VERSION = 1;

export type RuleCategory = "health" | "diet" | "allergen" | "nutrition" | "body" | "targeting";

export interface ClaimRule {
  id: string;
  category: RuleCategory;
  pattern: string;
  reason: string;
}

export const RULES: readonly ClaimRule[] = [
  {
    id: "health_words",
    category: "health",
    pattern: String.raw`\b(?:healthy|healthier|healthiest|healthful|health benefits?|wellness|well-being|wellbeing)\b`,
    reason: "Health claim: copy may not say a food or drink is healthy or good for wellbeing.",
  },
  {
    id: "good_for_you",
    category: "health",
    pattern: String.raw`\bgood[- ]for[- ](?:you|your (?:gut|heart|skin|body|health|digestion|bones|brain|mind))\b`,
    reason: "Health claim: copy may not say something is good for you or for a part of the body.",
  },
  {
    id: "immunity",
    category: "health",
    pattern: String.raw`\b(?:immunity|immune)\b`,
    reason: "Health claim: copy may not mention immunity.",
  },
  {
    id: "boost",
    category: "health",
    pattern: String.raw`\bboost(?:s|ed|ing)?\b`,
    reason: "Functional claim: copy may not say something boosts energy, mood or health.",
  },
  {
    id: "detox",
    category: "health",
    pattern: String.raw`\b(?:detox[a-z]*|super[- ]?foods?|super[- ]?grains?|antioxidants?|probiotics?|prebiotics?|adaptogens?|anti[- ]inflammatory|gut[- ](?:friendly|health)|digestion|digestive)\b`,
    reason: "Health claim: detox, superfood, antioxidant, gut or digestion wording is not allowed.",
  },
  {
    id: "cure",
    category: "health",
    pattern: String.raw`\b(?:cures?|heals?|healing|therapeutic|medicinal|clinically (?:proven|tested))\b`,
    reason: "Medical claim: copy may not say something cures, heals or treats.",
  },
  {
    id: "function_verbs",
    category: "health",
    pattern: String.raw`\b(?:improves?|supports?|promotes?|aids?|helps? with) (?:your )?(?:digestion|focus|sleep|mood|health|metabolism|memory|concentration|weight|recovery|energy)\b`,
    reason: "Functional claim: copy may not say something improves or supports a bodily function.",
  },
  {
    id: "free_from",
    category: "diet",
    pattern: String.raw`\b(?:gluten|dairy|nut|nuts|sugar|egg|soy|lactose|wheat|grain|oil|fat|caffeine|alcohol)[- ]?free\b`,
    reason: "Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar).",
  },
  {
    id: "free_of",
    category: "diet",
    pattern: String.raw`\b(?:free (?:of|from) (?:gluten|dairy|nuts?|sugar|eggs?|soy|lactose|wheat|animal products)|(?:zero|no added|no refined) sugar)\b`,
    reason: "Diet or allergen claim: no 'free of' or 'no added sugar' claims.",
  },
  {
    id: "diet_labels",
    category: "diet",
    pattern: String.raw`\b(?:vegan|vegans|vegetarian|vegetarians|plant[- ]based|keto|ketogenic|paleo|whole30|low[- ]?carb|pescatarian|halal|kosher)\b`,
    reason: "Diet claim: vegan, vegetarian, keto, halal and similar diet labels are not allowed.",
  },
  {
    id: "low_x",
    category: "diet",
    pattern: String.raw`\b(?:(?:low|lower|reduced)[- ](?:calorie|calories|cal|carb|carbs|sugar|fat|sodium|salt|gi|glycemic)|less (?:sugar|fat|salt))\b`,
    reason: "Nutrition claim: 'low' or 'reduced' sugar, calorie, fat or salt claims are not allowed.",
  },
  {
    id: "calories",
    category: "nutrition",
    pattern: String.raw`\b(?:calories?|kcals?|kilojoules?|macros?|carbs|carbohydrates?|\d+ ?cals?)\b`,
    reason: "Nutrition claim: calorie, carb and macro figures are not allowed.",
  },
  {
    id: "allergen_words",
    category: "allergen",
    pattern: String.raw`\b(?:(?:hypo)?allerg[a-z]*|celiac|coeliac|intoleran[a-z]*|cross[- ]contact|cross[- ]contamination|traces of|gluten|lactose|diabet[a-z]*)\b`,
    reason: "Allergen claim: copy may not mention allergens, allergies, intolerances or gluten.",
  },
  {
    id: "safe_for",
    category: "allergen",
    pattern: String.raw`\bsafe for (?:people with|those with|diabetics|celiacs|coeliacs|vegans|vegetarians)\b`,
    reason: "Allergen or diet claim: copy may not say something is safe for a dietary group.",
  },
  {
    id: "nutrition_words",
    category: "nutrition",
    pattern: String.raw`\b(?:nutritious|nutritional|nutrition|nutrients?|nutrient[- ](?:rich|dense)|vitamins?|fib(?:re|er)|electrolytes?|omega[- ]?3)\b`,
    reason: "Nutrition claim: nutrient, vitamin and fibre wording is not allowed.",
  },
  {
    id: "protein",
    category: "nutrition",
    pattern: String.raw`\bprotein\b`,
    reason: "Nutrition claim: copy may not mention protein.",
  },
  {
    id: "body_goals",
    category: "body",
    pattern: String.raw`\b(?:weight[- ]?(?:loss|management|watchers?)|slimming|fat[- ]burning|burns? (?:fat|calories)|builds? muscle|muscle[- ](?:building|recovery)|sustained energy|natural energy|diet|dieting|dieters?|guilt[- ]free|clean[- ]eating)\b`,
    reason: "Body claim: weight, diet, muscle and 'guilt-free' wording is not allowed.",
  },
  {
    id: "target_for_group",
    category: "targeting",
    pattern: String.raw`\b(?:for|to|aimed at|designed for|perfect for|made for|targeting) (?:(?:young|older|elderly|busy|working|single|married|retired|new|local) ){0,3}(?:women|men|girls|boys|ladies|guys|moms|mums|dads|mothers|fathers|seniors|elderly|millennials|boomers|gen ?z|teens|teenagers|kids|children)\b`,
    reason: "Identity targeting: copy may not address an age or gender group.",
  },
  {
    id: "target_age_band",
    category: "targeting",
    pattern: String.raw`\bin (?:their|your) (?:early |mid |late )?(?:teens|twenties|thirties|forties|fifties|sixties|[1-9]0s)\b`,
    reason: "Identity targeting: copy may not address an age band.",
  },
  {
    id: "target_identity",
    category: "targeting",
    pattern: String.raw`\b(?:christian|muslim|jewish|hindu|buddhist|sikh|black|white|asian|latino|latina|latinx|hispanic|arab|indian|chinese|gay|lesbian|lgbtq\+?|queer|straight|disabled|immigrant|expat)s? (?:customers?|neighbou?rs|folks|crowd|community|clientele|diners|guests|regulars)\b`,
    reason: "Identity targeting: copy may not address an ethnic, religious or other identity group.",
  },
  {
    id: "target_words",
    category: "targeting",
    pattern: String.raw`\b(?:demographics?|ethnicity|religion|religious|racial)\b`,
    reason: "Identity targeting: demographic, ethnicity and religion wording is not allowed.",
  },
];

const COMPILED: ReadonlyArray<{ rule: ClaimRule; rx: RegExp }> = RULES.map((rule) => ({
  rule,
  rx: new RegExp(rule.pattern, "i"),
}));

const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;

/** NFKC, strip zero-width characters, map unicode dashes to "-". Mirrors `normalize` in catalogue.py. */
export function normalizeCopy(text: string | null | undefined): string {
  return (text ?? "").normalize("NFKC").replace(ZERO_WIDTH, "").replace(DASHES, "-");
}

export interface ClaimHit {
  rule: ClaimRule;
  match: string;
}

/** First match of every rule that fires, in catalogue order. */
export function findHits(text: string | null | undefined): ClaimHit[] {
  const value = normalizeCopy(text);
  const hits: ClaimHit[] = [];
  for (const { rule, rx } of COMPILED) {
    const m = rx.exec(value);
    if (m) hits.push({ rule, match: m[0] });
  }
  return hits;
}

export function reasonsFor(hits: readonly ClaimHit[]): string[] {
  return hits.map((h) => `${h.rule.reason} Matched "${h.match}".`);
}
