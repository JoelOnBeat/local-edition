"""Claim catalogue for Local Edition copy.

Pure standard library so it can be loaded without NeMo (tests, tooling). The TypeScript mirror in
src/server/guardrails/catalogue.ts must stay identical: a vitest test runs this file and compares
rule ids, categories, patterns, reasons and match results phrase by phrase.

Pattern syntax is the subset shared by Python `re` and JavaScript RegExp (flags: case-insensitive).
Text is normalised first (NFKC, zero-width characters removed, dashes mapped to "-").
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from typing import Dict, List, NamedTuple, Optional

CATALOGUE_VERSION = 1

_ZERO_WIDTH = re.compile("[​‌‍⁠﻿­]")
_DASHES = re.compile("[‐-―−]")


class Rule(NamedTuple):
    id: str
    category: str  # health | diet | allergen | nutrition | body | targeting
    pattern: str
    reason: str


RULES: List[Rule] = [
    Rule("health_words", "health",
         r"\b(?:healthy|healthier|healthiest|healthful|health benefits?|wellness|well-being|wellbeing)\b",
         "Health claim: copy may not say a food or drink is healthy or good for wellbeing."),
    Rule("good_for_you", "health",
         r"\bgood[- ]for[- ](?:you|your (?:gut|heart|skin|body|health|digestion|bones|brain|mind))\b",
         "Health claim: copy may not say something is good for you or for a part of the body."),
    Rule("immunity", "health",
         r"\b(?:immunity|immune)\b",
         "Health claim: copy may not mention immunity."),
    Rule("boost", "health",
         r"\bboost(?:s|ed|ing)?\b",
         "Functional claim: copy may not say something boosts energy, mood or health."),
    Rule("detox", "health",
         r"\b(?:detox[a-z]*|super[- ]?foods?|super[- ]?grains?|antioxidants?|probiotics?|prebiotics?|adaptogens?"
         r"|anti[- ]inflammatory|gut[- ](?:friendly|health)|digestion|digestive)\b",
         "Health claim: detox, superfood, antioxidant, gut or digestion wording is not allowed."),
    Rule("cure", "health",
         r"\b(?:cures?|heals?|healing|therapeutic|medicinal|clinically (?:proven|tested))\b",
         "Medical claim: copy may not say something cures, heals or treats."),
    Rule("function_verbs", "health",
         r"\b(?:improves?|supports?|promotes?|aids?|helps? with) (?:your )?"
         r"(?:digestion|focus|sleep|mood|health|metabolism|memory|concentration|weight|recovery|energy)\b",
         "Functional claim: copy may not say something improves or supports a bodily function."),
    Rule("free_from", "diet",
         r"\b(?:gluten|dairy|nut|nuts|sugar|egg|soy|lactose|wheat|grain|oil|fat|caffeine|alcohol)[- ]?free\b",
         "Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar)."),
    Rule("free_of", "diet",
         r"\b(?:free (?:of|from) (?:gluten|dairy|nuts?|sugar|eggs?|soy|lactose|wheat|animal products)"
         r"|(?:zero|no added|no refined) sugar)\b",
         "Diet or allergen claim: no 'free of' or 'no added sugar' claims."),
    Rule("diet_labels", "diet",
         r"\b(?:vegan|vegans|vegetarian|vegetarians|plant[- ]based|keto|ketogenic|paleo|whole30|low[- ]?carb"
         r"|pescatarian|halal|kosher)\b",
         "Diet claim: vegan, vegetarian, keto, halal and similar diet labels are not allowed."),
    Rule("low_x", "diet",
         r"\b(?:(?:low|lower|reduced)[- ](?:calorie|calories|cal|carb|carbs|sugar|fat|sodium|salt|gi|glycemic)"
         r"|less (?:sugar|fat|salt))\b",
         "Nutrition claim: 'low' or 'reduced' sugar, calorie, fat or salt claims are not allowed."),
    Rule("calories", "nutrition",
         r"\b(?:calories?|kcals?|kilojoules?|macros?|carbs|carbohydrates?|\d+ ?cals?)\b",
         "Nutrition claim: calorie, carb and macro figures are not allowed."),
    Rule("allergen_words", "allergen",
         r"\b(?:(?:hypo)?allerg[a-z]*|celiac|coeliac|intoleran[a-z]*|cross[- ]contact|cross[- ]contamination"
         r"|traces of|gluten|lactose|diabet[a-z]*)\b",
         "Allergen claim: copy may not mention allergens, allergies, intolerances or gluten."),
    Rule("safe_for", "allergen",
         r"\bsafe for (?:people with|those with|diabetics|celiacs|coeliacs|vegans|vegetarians)\b",
         "Allergen or diet claim: copy may not say something is safe for a dietary group."),
    Rule("nutrition_words", "nutrition",
         r"\b(?:nutritious|nutritional|nutrition|nutrients?|nutrient[- ](?:rich|dense)|vitamins?|fib(?:re|er)"
         r"|electrolytes?|omega[- ]?3)\b",
         "Nutrition claim: nutrient, vitamin and fibre wording is not allowed."),
    Rule("protein", "nutrition",
         r"\bprotein\b",
         "Nutrition claim: copy may not mention protein."),
    Rule("body_goals", "body",
         r"\b(?:weight[- ]?(?:loss|management|watchers?)|slimming|fat[- ]burning|burns? (?:fat|calories)"
         r"|builds? muscle|muscle[- ](?:building|recovery)|sustained energy|natural energy|diet|dieting|dieters?"
         r"|guilt[- ]free|clean[- ]eating)\b",
         "Body claim: weight, diet, muscle and 'guilt-free' wording is not allowed."),
    Rule("target_for_group", "targeting",
         r"\b(?:for|to|aimed at|designed for|perfect for|made for|targeting) "
         r"(?:(?:young|older|elderly|busy|working|single|married|retired|new|local) ){0,3}"
         r"(?:women|men|girls|boys|ladies|guys|moms|mums|dads|mothers|fathers|seniors|elderly|millennials"
         r"|boomers|gen ?z|teens|teenagers|kids|children)\b",
         "Identity targeting: copy may not address an age or gender group."),
    Rule("target_age_band", "targeting",
         r"\bin (?:their|your) (?:early |mid |late )?(?:teens|twenties|thirties|forties|fifties|sixties|[1-9]0s)\b",
         "Identity targeting: copy may not address an age band."),
    Rule("target_identity", "targeting",
         r"\b(?:christian|muslim|jewish|hindu|buddhist|sikh|black|white|asian|latino|latina|latinx|hispanic|arab"
         r"|indian|chinese|gay|lesbian|lgbtq\+?|queer|straight|disabled|immigrant|expat)s? "
         r"(?:customers?|neighbou?rs|folks|crowd|community|clientele|diners|guests|regulars)\b",
         "Identity targeting: copy may not address an ethnic, religious or other identity group."),
    Rule("target_words", "targeting",
         r"\b(?:demographics?|ethnicity|religion|religious|racial)\b",
         "Identity targeting: demographic, ethnicity and religion wording is not allowed."),
]

_COMPILED = [(r, re.compile(r.pattern, re.IGNORECASE)) for r in RULES]


def normalize(text: Optional[str]) -> str:
    """NFKC, strip zero-width characters, map unicode dashes to '-'. Mirrors normalizeCopy in TS."""
    value = unicodedata.normalize("NFKC", text or "")
    value = _ZERO_WIDTH.sub("", value)
    return _DASHES.sub("-", value)


class Hit(NamedTuple):
    rule: Rule
    match: str


def find_hits(text: Optional[str]) -> List[Hit]:
    """First match of every rule that fires, in catalogue order."""
    value = normalize(text)
    hits: List[Hit] = []
    for rule, rx in _COMPILED:
        m = rx.search(value)
        if m:
            hits.append(Hit(rule, m.group(0)))
    return hits


def reasons_for(hits: List[Hit]) -> List[str]:
    return [f'{h.rule.reason} Matched "{h.match}".' for h in hits]


def _catalogue_json() -> Dict[str, object]:
    return {
        "version": CATALOGUE_VERSION,
        "rules": [r._asdict() for r in RULES],
    }


if __name__ == "__main__":
    # `catalogue.py --json`: dump the rules. `catalogue.py --check`: read a JSON array of phrases from stdin,
    # print [[ruleId, match], ...] per phrase. Used by the vitest parity test.
    if "--json" in sys.argv:
        print(json.dumps(_catalogue_json()))
    elif "--check" in sys.argv:
        phrases = json.load(sys.stdin)
        print(json.dumps([[[h.rule.id, h.match] for h in find_hits(p)] for p in phrases]))
    else:
        sys.exit("usage: catalogue.py --json | --check")
