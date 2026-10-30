"""Spec space and prompts for the Local Edition copy fine-tune.

Menu items are the sample chain "Kettle & Kiln (sample chain)" (fixtures/sample/menu-board.html). The neighbourhood
descriptions are invented plain words written for this task: they are NOT Qloo or Tavily data and name no real person.
Train and test use DISJOINT menu items AND DISJOINT neighbourhoods.
"""
from __future__ import annotations

import random
from typing import Dict, List, NamedTuple


class Spec(NamedTuple):
    item: str
    category: str
    price: str  # "4.75"
    neighbourhood: str
    tone: str


# (name, category, price) from the sample menu. TEST_ITEMS are held out of training entirely.
ITEMS = [
    ("Espresso", "Coffee", "3.50"), ("Cortado", "Coffee", "4.75"), ("Flat White", "Coffee", "5.25"),
    ("Latte", "Coffee", "5.50"), ("Batch Brew", "Coffee", "3.75"), ("Pour Over", "Coffee", "6.25"),
    ("Mocha", "Coffee", "6.00"), ("Cold Brew", "Cold", "5.00"), ("Iced Latte", "Cold", "5.75"),
    ("Nitro Cold Brew", "Cold", "6.00"), ("Sparkling Lemonade", "Cold", "4.50"), ("Masala Chai", "Tea", "5.00"),
    ("Matcha Latte", "Tea", "6.00"), ("Hojicha", "Tea", "4.75"), ("Butter Croissant", "Bakery", "4.25"),
    ("Almond Croissant", "Bakery", "5.25"), ("Banana Bread", "Bakery", "4.50"),
    ("Brown Butter Cookie", "Bakery", "3.75"), ("Cardamom Morning Bun", "Bakery", "5.00"),
    ("Avocado Toast", "Food", "11.50"), ("Egg and Cheddar Sandwich", "Food", "9.75"),
    ("Yogurt and Granola Cup", "Food", "7.50"),
]
TEST_ITEMS = {"Cortado", "Nitro Cold Brew", "Matcha Latte", "Almond Croissant", "Mocha", "Egg and Cheddar Sandwich"}

TRAIN_HOODS = [
    "quiet residential blocks of brownstones, dog walkers and weekday stroller traffic",
    "a busy transit hub with commuters rushing past and a steady morning queue",
    "a leafy campus district full of students with laptops and late-afternoon study groups",
    "old warehouses turned into studios, with artists and delivery bikes on cobbled streets",
    "a waterfront promenade where joggers, cyclists and tourists pass all weekend",
    "a lively market street with produce stalls, noisy lunch crowds and street musicians",
    "a financial district of glass towers, early starts and quick desk lunches",
    "a sleepy corner of corner stores and stoops where neighbours know each other by name",
    "a theatre district with pre-show dinners and late-night crowds spilling out",
    "a hilltop village feel with small shops, a library and slow Sunday mornings",
    "a mixed neighbourhood of print shops, barbers and family-run bakeries",
    "a gallery quarter with openings on Thursday nights and quiet weekday afternoons",
    "a park-side strip where families gather after soccer games and picnics",
    "an industrial edge with night-shift workers and a few new apartment blocks",
    "a hospital-adjacent street with visitors, nurses coming off shift and long waits",
    "a ferry landing with sea air, commuters and weekend day-trippers",
    "a tree-lined avenue of bookshops, record stores and cafes with outdoor tables",
    "a corner by the stadium that goes wild on match days and stays calm otherwise",
]
TEST_HOODS = [
    "a sunny plaza with a fountain, street chess players and office workers on lunch breaks",
    "a tidy row of townhouses near a community garden and a weekly farmers' market",
    "a bustling bus terminal district with rolling suitcases and early departures",
    "an arts-school block with sketchbooks, paint-stained jackets and noisy rehearsals upstairs",
    "a rainy harbour street with fishing boats, foggy mornings and a few regulars at the window",
    "a new development of glass lofts with co-working spaces and remote workers on video calls",
]
TONES = ["warm", "playful", "understated", "brisk", "wry", "cosy"]

ANGLES = [  # teacher-only variety hints; they do not appear in the student prompt
    "lean on a sensory detail", "mention the time of day", "mention the weather or the season",
    "nod to the people on the street", "keep it plain and confident", "use one short punchy fragment",
    "suggest a pairing with something else on the menu", "make it feel like a regular's habit",
]

RULES_TEXT = (
    "Rules: no health, nutrition, allergen or diet claims (nothing about being healthy, boosting, protein, "
    "gluten, vegan and similar); no superlatives such as best, finest or #1; do not state any price other than "
    "the one given; do not invent offers or discounts."
)


def student_messages(s: Spec) -> List[Dict[str, str]]:
    """THE prompt: identical for training, base zero-shot eval and tuned eval."""
    user = (
        "You write short in-store edition copy for a coffee shop chain.\n"
        f"Item: {s.item} ({s.category}, ${s.price})\n"
        f"Neighbourhood: {s.neighbourhood}\n"
        f"Tone: {s.tone}\n"
        f"{RULES_TEXT}\n"
        "Reply with only one JSON object with exactly these keys: "
        '"special_name" (a short name for today\'s special, at most 6 words), '
        '"line" (the shelf line, at most 20 words), '
        '"say_it" (what a staff member says to a guest, first person, at most 18 words).'
    )
    return [{"role": "system", "content": "detailed thinking off"}, {"role": "user", "content": user}]


def teacher_messages(s: Spec, angle: str) -> List[Dict[str, str]]:
    user = (
        "Write in-store edition copy for a coffee shop menu special.\n"
        f"Item: {s.item} ({s.category}, ${s.price})\nNeighbourhood character: {s.neighbourhood}\nTone: {s.tone}\n"
        f"Angle for variety: {angle}.\n"
        f"{RULES_TEXT}\n"
        "special_name: 1 to 6 words, a name for the special. line: at most 20 words, concrete and specific to the "
        "neighbourhood, no stock phrases. say_it: at most 18 words, first person as a barista speaking to a guest "
        "(use I, my or we). Plain words, no emojis, no hashtags."
    )
    return [{"role": "user", "content": user}]


def all_specs(items, hoods) -> List[Spec]:
    return [Spec(n, c, p, h, t) for (n, c, p) in items for h in hoods for t in TONES]


def build_specs(seed: int, n_train: int, n_test: int):
    rng = random.Random(seed)
    train_items = [i for i in ITEMS if i[0] not in TEST_ITEMS]
    test_items = [i for i in ITEMS if i[0] in TEST_ITEMS]
    tr, te = all_specs(train_items, TRAIN_HOODS), all_specs(test_items, TEST_HOODS)
    rng.shuffle(tr)
    rng.shuffle(te)
    return tr[:n_train], te[:n_test]
