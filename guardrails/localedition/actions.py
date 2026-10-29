"""Custom NeMo output rail for Local Edition copy.

check_health_claims is OUR code (the regex catalogue in catalogue.py) that NeMo's runtime executes as a
custom action: health, diet, nutrition, allergen and identity-targeting claims. The LLM rail,
`self check output`, is NeMo's built-in (its prompt is in prompts.yml), so it has no code here.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import catalogue  # noqa: E402
import rail_info  # noqa: E402
from nemoguardrails.actions import action  # noqa: E402
from nemoguardrails.actions.rail_outcome import RailOutcome  # noqa: E402


@action(is_system_action=True)
async def check_health_claims(bot_message: Optional[str] = None, context: Optional[dict] = None) -> RailOutcome:
    text = bot_message if bot_message is not None else str((context or {}).get("bot_message") or "")
    hits = catalogue.find_hits(text)
    if not hits:
        return RailOutcome.allow()
    reasons = catalogue.reasons_for(hits)
    rail_info.add_reasons(reasons)
    return RailOutcome.block(reason="; ".join(reasons), metadata={"rules": [h.rule.id for h in hits]})
