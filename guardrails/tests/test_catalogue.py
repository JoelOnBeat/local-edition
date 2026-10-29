import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "localedition"))

import catalogue  # noqa: E402

PHRASES = json.load(open(os.path.join(HERE, "phrases.json"), encoding="utf-8"))


@pytest.mark.parametrize("case", PHRASES, ids=[p["text"][:48] for p in PHRASES])
def test_phrase_table(case):
    fired = {h.rule.id for h in catalogue.find_hits(case["text"])}
    if case["blocks"]:
        assert set(case["blocks"]) <= fired, f"expected {case['blocks']} to fire, got {sorted(fired)}"
    else:
        assert not fired, f"expected a pass, got {sorted(fired)}"


def test_table_size():
    assert len(PHRASES) >= 40
    assert any(p["blocks"] for p in PHRASES) and any(not p["blocks"] for p in PHRASES)


def test_rule_ids_unique_and_reasons_clear():
    ids = [r.id for r in catalogue.RULES]
    assert len(ids) == len(set(ids))
    for r in catalogue.RULES:
        assert r.reason.endswith(".") and len(r.reason) > 20


def test_reason_strings_name_the_match():
    reasons = catalogue.reasons_for(catalogue.find_hits("A gluten-free bun"))
    assert any('Matched "gluten-free"' in r for r in reasons)


def test_normalize_handles_none_and_dashes():
    assert catalogue.normalize(None) == ""
    assert catalogue.normalize("a‑b​") == "a-b"


def test_parse_verdict():
    pytest.importorskip("nemoguardrails")
    sys.path.insert(0, os.path.join(HERE, "..", "localedition"))
    import actions  # noqa: E402

    assert actions.parse_verdict("Yes") is True
    assert actions.parse_verdict("<think>maybe no</think>\nNo.") is False
    assert actions.parse_verdict("<think>\nthe copy says yes\n</think> yes") is True
    assert actions.parse_verdict("perhaps") is None
    assert actions.parse_verdict("") is None
