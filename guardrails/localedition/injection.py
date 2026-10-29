"""Prompt-injection phrases in scraped web text (Tavily snippets). OUR code, standard library only.

A snippet is untrusted: a venue page can contain "ignore previous instructions". An event description or
tie-in written from one must not carry such text into copy, and must not reach the self-check model
unchanged. `strip` removes every sentence that holds a hit; `find` lists the hits.

The TypeScript mirror (src/server/guardrails/injection.ts) detects with the same patterns; a vitest test
compares rule ids and patterns, and runs both over tests/injection.json. Pattern syntax is the subset
shared by Python `re` and JavaScript RegExp (case-insensitive).
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import List, NamedTuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from catalogue import normalize  # noqa: E402


class Rule(NamedTuple):
    id: str
    pattern: str
    reason: str


RULES: List[Rule] = [
    Rule("ignore_instructions",
         r"\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,30}\b(?:previous|prior|above|earlier|preceding|all|any|your|the|these)\b"
         r"[^.!?\n]{0,30}\b(?:instructions?|prompts?|rules?|guidelines?|directions?|context|constraints?)\b",
         "Prompt injection: text tells the reader or a model to ignore its instructions."),
    Rule("role_override",
         r"\b(?:you are now|from now on,? you|act as|pretend (?:to be|you are)|behave as)\b[^.!?\n]{0,40}\b(?:assistant|ai|model|chatbot|bot|dan|system|admin|developer|jailbroken|unrestricted)\b",
         "Prompt injection: text tries to give a model a new role."),
    Rule("system_prompt",
         r"\b(?:system prompt|developer (?:message|prompt)|hidden (?:prompt|instructions?)|reveal (?:your|the) (?:instructions?|prompt|rules))\b",
         "Prompt injection: text refers to a model's system prompt or hidden instructions."),
    Rule("chat_markers",
         r"(?:<\|(?:im_start|im_end|system|user|assistant)\|>|\[/?inst\]|<</?sys>>|^\s*(?:system|assistant|developer)\s*:|###\s*(?:system|instruction|new instructions?))",
         "Prompt injection: text contains chat-template markers."),
    Rule("new_instructions",
         r"\b(?:new|updated|real|actual|additional) (?:instructions?|task|orders?|directive)s?\s*:",
         "Prompt injection: text announces new instructions."),
    Rule("conceal",
         r"\b(?:do not|don't|never) (?:tell|mention|reveal|show|inform) (?:the )?(?:user|reader|customer|operator|human)\b",
         "Prompt injection: text asks to hide something from the user."),
    Rule("tool_exfil",
         r"\b(?:send|post|forward|leak|exfiltrate|email) (?:this|the|your|all)\b[^.!?\n]{0,30}\b(?:conversation|api key|keys?|secrets?|credentials|tokens?|system prompt|chat history)\b",
         "Prompt injection: text asks to send out secrets or the conversation."),
]

_COMPILED = [(r, re.compile(r.pattern, re.IGNORECASE | re.MULTILINE)) for r in RULES]
_SENTENCE = re.compile(r"[^.!?\n]*[.!?]?\s*")


class Hit(NamedTuple):
    rule: Rule
    match: str


def find(text: str) -> List[Hit]:
    """First match of every rule that fires, in rule order."""
    value = normalize(text)
    hits: List[Hit] = []
    for rule, rx in _COMPILED:
        m = rx.search(value)
        if m:
            hits.append(Hit(rule, m.group(0).strip()))
    return hits


def strip(text: str) -> "tuple[str, List[Hit]]":
    """Return (text without every sentence that holds a hit, the hits). Clean text comes back unchanged."""
    original = text or ""
    hits = find(original)
    if not hits:
        return original, []
    kept: List[str] = []
    for sentence in _SENTENCE.findall(normalize(original)):
        if sentence and not any(rx.search(sentence) for _, rx in _COMPILED):
            kept.append(sentence)
    return re.sub(r"\s+", " ", "".join(kept)).strip(), hits


def _rules_json() -> dict:
    return {"rules": [r._asdict() for r in RULES]}


if __name__ == "__main__":
    # `injection.py --json`: dump the rules. `--check`: JSON array of phrases on stdin -> [[ruleId, match], ...] each.
    if "--json" in sys.argv:
        print(json.dumps(_rules_json()))
    elif "--check" in sys.argv:
        phrases = json.load(sys.stdin)
        print(json.dumps([[[h.rule.id, h.match] for h in find(p)] for p in phrases]))
    else:
        sys.exit("usage: injection.py --json | --check")
