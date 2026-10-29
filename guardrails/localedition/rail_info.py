"""Per-check side channel: the rail actions record why they blocked, and batch.py reads it back.

NeMo's RailsResult carries status, content and the blocking rail only, not the reasons.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Dict, Optional

INFO: ContextVar[Optional[Dict[str, Any]]] = ContextVar("le_rail_info", default=None)


def new_request() -> Dict[str, Any]:
    info: Dict[str, Any] = {"reasons": []}
    INFO.set(info)
    return info


def add_reasons(reasons: list) -> None:
    info = INFO.get()
    if info is not None:
        info["reasons"].extend(reasons)
