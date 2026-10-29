"""Batch certifier: Local Edition copy through NeMo Guardrails, returned as contract GuardrailResult dicts.

Used by jobs/certify.py inside a Nebius Serverless Job; never on a user's request path.

What is NeMo and what is ours (the reasons shown to head office say so):
  - NeMo Guardrails 0.24.1 (library): the runtime (LLMRails.check_async), the flow engine, and the built-in
    `self check output` rail with its LLM call to Lightning, reasoning off.
  - Our code run BY NeMo's runtime: the `check health claims` rail (regex catalogue, actions.py).
  - Our code run BEFORE NeMo: `strip prompt injection` (injection.py) on text that came from web snippets.
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import catalogue  # noqa: E402
import injection  # noqa: E402
import rail_info  # noqa: E402

RAIL_REGEX = "check health claims"
RAIL_SELF_CHECK = "self check output"
RAIL_INJECTION = "strip prompt injection"
MAX_REASON = 300
MAX_REASONS = 6

PASS_NOTE = "Passed: our regex catalogue (run by NeMo Guardrails) and NeMo's self check output on Lightning."
SELF_CHECK_BLOCK = (
    "NeMo self check output (Lightning): the copy breaks the brand voice or the claims policy."
)


class CheckFailed(Exception):
    """The rails could not give a verdict (model call failed). The item is left for the next run."""


def brief(brand_voice: List[str], kind: str) -> str:
    """The user turn handed to `self check output` as {{ user_input }}. Mirrored by briefText() in self-check.ts."""
    voice = "; ".join(v.strip() for v in brand_voice if v and v.strip()) or "none given"
    return f"Brand voice: {voice}. Copy type: {kind}."


@dataclass
class Checked:
    guardrail: Dict[str, Any]
    stripped: str = ""


@dataclass
class Usage:
    """Token Factory usage of every model call this Certifier made (NeMo's own accounting is reset per call)."""

    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0


def _clip(reasons: List[str]) -> List[str]:
    out: List[str] = []
    for r in reasons:
        r = r.strip()
        if r and r not in out:
            out.append(r[:MAX_REASON])
    return out[:MAX_REASONS]


class Certifier:
    def __init__(self, config_dir: Optional[str] = None, base_url: Optional[str] = None, concurrency: int = 6):
        from nemoguardrails import LLMRails, RailsConfig

        if not (os.environ.get("NEBIUS_API_KEY") or "").strip():
            raise RuntimeError("NEBIUS_API_KEY is required: NeMo's self check output calls Lightning on Token Factory.")
        config = RailsConfig.from_path(config_dir or HERE)
        main = next(m for m in config.models if m.type == "main")
        if base_url:
            main.parameters["base_url"] = base_url
        self.model = main.model
        self.rails = LLMRails(config)
        self.usage = Usage()
        self._meter(self.rails.llm)
        self._gate = asyncio.Semaphore(concurrency)

    def _meter(self, llm: Any) -> None:
        """Wrap the model so every response's usage lands in self.usage."""
        original = llm.generate_async
        usage = self.usage

        async def generate_async(*args: Any, **kwargs: Any) -> Any:
            response = await original(*args, **kwargs)
            u = getattr(response, "usage", None)
            usage.calls += 1
            if u:
                usage.prompt_tokens += int(u.input_tokens or 0)
                usage.completion_tokens += int(u.output_tokens or 0)
                usage.reasoning_tokens += int(getattr(u, "reasoning_tokens", 0) or 0)
            return response

        llm.generate_async = generate_async

    async def check(self, text: str, kind: str, brand_voice: List[str], from_web: bool = False) -> Checked:
        """One verdict. `from_web` is true for text built from Tavily snippets (event items)."""
        from nemoguardrails.rails.llm.options import RailStatus, RailType

        async with self._gate:
            clean = text
            if from_web:
                clean, hits = injection.strip(text)
                if hits:
                    reasons = [f'{h.rule.reason} Removed "{h.match[:80]}".' for h in hits]
                    return Checked(
                        guardrail={"status": "blocked", "rail": RAIL_INJECTION, "reasons": _clip(reasons + ["Our code, run before NeMo: head office should edit the event text."]), "original": text},
                        stripped=clean,
                    )
            rail_info.new_request()
            try:
                result = await self.rails.check_async(
                    [{"role": "user", "content": brief(brand_voice, kind)}, {"role": "assistant", "content": clean}],
                    rail_types=[RailType.OUTPUT],
                )
            except Exception as exc:  # noqa: BLE001 - any model or runtime failure: no verdict, never a pass
                raise CheckFailed(type(exc).__name__) from exc
            info = rail_info.INFO.get() or {"reasons": []}
            if result.status == RailStatus.BLOCKED:
                rail = result.rail or RAIL_SELF_CHECK
                if rail == RAIL_REGEX:
                    reasons = ["Our regex catalogue (run by NeMo Guardrails) blocked this copy."] + info["reasons"]
                else:
                    reasons = [SELF_CHECK_BLOCK]
                return Checked(guardrail={"status": "blocked", "rail": rail, "reasons": _clip(reasons), "original": text})
            if result.status == RailStatus.MODIFIED:
                return Checked(guardrail={"status": "rewritten", "reasons": _clip(info["reasons"] or ["NeMo Guardrails rewrote the copy."]), "original": text})
            return Checked(guardrail={"status": "passed", "reasons": [PASS_NOTE]})
