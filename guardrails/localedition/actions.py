"""Custom output rails for Local Edition copy.

check_health_claims: deterministic regex catalogue (catalogue.py) for health, diet, nutrition, allergen
and identity-targeting claims. check_brand_voice: LLM self-check of the copy against the brand voice
passed in the request context (`guardrails.context.brand_voice`); it degrades to "skipped" when there is
no model key, no brand voice, or the model call fails or answers unparseably. It never blocks on a
failure of its own.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from typing import Any, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import catalogue  # noqa: E402
import rail_info  # noqa: E402
from nemoguardrails.actions import action  # noqa: E402
from nemoguardrails.actions.rail_outcome import RailOutcome  # noqa: E402

log = logging.getLogger("localedition.rails")

BRAND_VOICE_TASK = "brand_voice_check"
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_VERDICT = re.compile(r"\b(yes|no)\b", re.IGNORECASE)


def _text(bot_message: Optional[str], context: Optional[Dict[str, Any]]) -> str:
    if bot_message is not None:
        return bot_message
    return str((context or {}).get("bot_message") or "")


@action(is_system_action=True)
async def check_health_claims(bot_message: Optional[str] = None, context: Optional[dict] = None) -> RailOutcome:
    hits = catalogue.find_hits(_text(bot_message, context))
    if not hits:
        return RailOutcome.allow()
    reasons = catalogue.reasons_for(hits)
    rail_info.add_reasons(reasons)
    return RailOutcome.block(reason="; ".join(reasons), metadata={"rules": [h.rule.id for h in hits]})


def _voice_text(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        return "\n".join(f"- {str(v).strip()}" for v in value if str(v).strip())
    return str(value or "").strip()


def parse_verdict(response: str) -> Optional[bool]:
    """True = break (block), False = fits, None = unparseable. Strips reasoning blocks first."""
    cleaned = _THINK.sub("", response or "").strip()
    m = _VERDICT.search(cleaned)
    if not m:
        return None
    return m.group(1).lower() == "yes"


def _has_key() -> bool:
    key = (os.environ.get("NEBIUS_API_KEY") or "").strip()
    return bool(key) and key != rail_info.NO_KEY_SENTINEL


@action(is_system_action=True)
async def check_brand_voice(
    llms: Optional[dict] = None,
    llm_task_manager: Any = None,
    context: Optional[dict] = None,
    llm: Any = None,
    config: Any = None,
    bot_message: Optional[str] = None,
    **kwargs: Any,
) -> RailOutcome:
    ctx = context or {}
    copy = _text(bot_message, ctx)
    voice = _voice_text(ctx.get("brand_voice"))
    if not voice:
        rail_info.add_skip("check brand voice", "no brand voice supplied")
        return RailOutcome.allow(metadata={"skipped": True})
    if not _has_key():
        rail_info.add_skip("check brand voice", "no model key configured")
        return RailOutcome.allow(metadata={"skipped": True})
    try:
        from nemoguardrails.llm.call import llm_call  # imported late: only needed with a key

        model = (llms or {}).get(BRAND_VOICE_TASK) or llm
        prompt = llm_task_manager.render_task_prompt(
            task=BRAND_VOICE_TASK,
            context={"bot_response": copy, "brand_voice": voice, "kind": str(ctx.get("kind") or "copy")},
        )
        response = await llm_call(
            model,
            prompt,
            stop=llm_task_manager.get_stop_tokens(task=BRAND_VOICE_TASK),
            llm_params={"temperature": 0.0, "max_tokens": llm_task_manager.get_max_tokens(task=BRAND_VOICE_TASK) or 1024},
        )
        verdict = parse_verdict(response.content)
    except Exception as exc:  # noqa: BLE001 - a failed self-check must not take the regex rail down
        log.warning("brand voice check failed: %s", type(exc).__name__)
        rail_info.add_skip("check brand voice", f"model call failed ({type(exc).__name__})")
        return RailOutcome.allow(metadata={"skipped": True})
    if verdict is None:
        rail_info.add_skip("check brand voice", "model answer was not yes or no")
        return RailOutcome.allow(metadata={"skipped": True})
    if verdict:
        reason = "Brand voice: the copy does not fit the brand voice for this chain."
        rail_info.add_reasons([reason])
        return RailOutcome.block(reason=reason)
    return RailOutcome.allow()
