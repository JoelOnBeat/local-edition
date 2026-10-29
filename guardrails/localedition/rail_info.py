"""Per-request side channel between the rail actions and the HTTP layer (see ../config.py).

The standard /v1/checks body only carries status, content and the blocking rail. The actions record why
they blocked and which checks they skipped here; ../config.py returns it in the `x-le-rails` header.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Dict, Optional

NO_KEY_SENTINEL = "unset-no-key"  # NeMo refuses to load a config whose key env var is unset

INFO: ContextVar[Optional[Dict[str, Any]]] = ContextVar("le_rail_info", default=None)


def new_request() -> Dict[str, Any]:
    info: Dict[str, Any] = {"reasons": [], "skipped": []}
    INFO.set(info)
    return info


def add_reasons(reasons: list) -> None:
    info = INFO.get()
    if info is not None:
        info["reasons"].extend(reasons)


def add_skip(rail: str, why: str) -> None:
    info = INFO.get()
    if info is not None:
        info["skipped"].append({"rail": rail, "why": why})
