"""Deterministic house-rule checker: the data filter AND the eval metric (one definition, used for both).

Health, diet, allergen, nutrition, body and targeting claims come from the app's own regex catalogue
(guardrails/localedition/catalogue.py, copied into the job as catalogue.py). Added here: superlatives, invented
prices and offers, length limits, key format and first-person voice.
"""
from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Tuple

from catalogue import find_hits, normalize

KEYS = ("special_name", "line", "say_it")
WORD = re.compile(r"[\w$][\w'’$.-]*")
SUPERLATIVE = re.compile(
    r"\b(?:best|finest|greatest|top[- ]rated|number (?:one|1)|no\.? ?1|unrivall?ed|unmatched|unbeatable|ultimate|"
    r"world[- ]class|award[- ]winning|most (?:delicious|popular|loved|amazing|incredible)|"
    r"(?:fresh|rich|smooth|bold|creamy|crisp|crispi|flaki|warm|hott|cold|tasti|sweet|strong|silk[a-z]*|cosi|"
    r"cozi|mellow|buttery|nutti|toasti|spiciest|brightest)est)\b|#\s?1\b",
    re.IGNORECASE,
)
SUPER_EXTRA = re.compile(r"\b(?:freshest|richest|smoothest|boldest|creamiest|crispiest|flakiest|warmest|hottest|coldest|tastiest|sweetest|strongest|silkiest|cosiest|coziest|mellowest|butteriest|toastiest|brightest|smoothest)\b", re.IGNORECASE)
PRICE = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)\b", re.IGNORECASE)
OFFER = re.compile(r"\b(?:\d+ ?% off|discount|half[- ]price|two[- ]for[- ]one|2[- ]for[- ]1|bogo|buy one|free refill|on the house|free)\b", re.IGNORECASE)
FIRST_PERSON = re.compile(r"\b(?:i|i'm|i’m|i'll|i’ll|i've|i’ve|my|me|we|we're|we’re|we'll|we’ll|our|us|let me|let us)\b", re.IGNORECASE)


def words(s: str) -> int:
    return len(WORD.findall(s))


def parse_strict(text: str) -> Optional[Dict]:
    try:
        v = json.loads(text.strip())
    except (ValueError, TypeError):
        return None
    return v if isinstance(v, dict) else None


def parse_lenient(text: str) -> Optional[Dict]:
    """First {...} block, after dropping a <think> section and code fences."""
    t = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    a, b = t.find("{"), t.rfind("}")
    return parse_strict(t[a:b + 1]) if a != -1 and b > a else None


def keys_exact(d: Optional[Dict]) -> bool:
    return bool(d) and tuple(sorted(d.keys())) == tuple(sorted(KEYS)) and all(isinstance(d[k], str) for k in KEYS)


def length_ok(d: Optional[Dict]) -> bool:
    if not keys_exact(d):
        return False
    return 1 <= words(d["special_name"]) <= 6 and 1 <= words(d["line"]) <= 20 and 1 <= words(d["say_it"]) <= 18


def voice_ok(d: Optional[Dict]) -> bool:
    return keys_exact(d) and bool(FIRST_PERSON.search(normalize(d["say_it"])))


def rule_hits(text: str, price: str) -> List[Tuple[str, str]]:
    """(rule id, matched text) for every house rule the text breaks. `price` is the one allowed price, e.g. "4.75"."""
    t = normalize(text)
    hits = [(h.rule.id, h.match) for h in find_hits(t)]
    for rx, rid in ((SUPERLATIVE, "superlative"), (SUPER_EXTRA, "superlative"), (OFFER, "invented_offer")):
        m = rx.search(t)
        if m and (rid, m.group(0)) not in hits:
            hits.append((rid, m.group(0)))
    allowed = float(price)
    for m in PRICE.finditer(t):
        if abs(float(m.group(1) or m.group(2)) - allowed) > 1e-9:
            hits.append(("invented_price", m.group(0)))
    return hits


def check(output: str, price: str, strict: bool = True) -> Dict[str, bool]:
    """Every metric for one raw model output."""
    d = parse_strict(output) if strict else parse_lenient(output)
    text = " ".join(str(d.get(k, "")) for k in KEYS) if d else (output or "")
    violation = bool(rule_hits(text, price))
    ok_keys, ok_len, ok_voice = keys_exact(d), length_ok(d), voice_ok(d)
    return {
        "json_valid": d is not None, "keys_exact": ok_keys, "length_ok": ok_len, "voice_ok": ok_voice,
        "violation": violation, "all_pass": bool(d) and ok_keys and ok_len and ok_voice and not violation,
    }
