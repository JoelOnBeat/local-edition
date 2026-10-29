"""Server init for the NeMo Guardrails app (loaded by `nemoguardrails server --config guardrails`).

Adds one ASGI middleware around the whole server:
  1. shared-secret auth on EVERY path except GET /v1/health: when GUARDRAILS_TOKEN is set, the header
     `x-le-guard-token` must match (the stock server has no auth, `/v1/chat/completions` is a general model
     proxy and the brand-voice rail spends the model key);
  2. attaches the rails' reasons and skipped checks as the `x-le-rails` response header (JSON).

The server refuses to start when NEBIUS_API_KEY is set and GUARDRAILS_TOKEN is empty: a public sidecar
with a live model key would be a free LLM for anyone who finds it.
"""

from __future__ import annotations

import hmac
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "localedition"))

import rail_info  # noqa: E402

OPEN_PATHS = frozenset({"/v1/health"})


def check_startup(environ=os.environ):
    """Raise when a real model key is configured without a shared secret. Pure: tests call it directly."""
    key = (environ.get("NEBIUS_API_KEY") or "").strip()
    token = (environ.get("GUARDRAILS_TOKEN") or "").strip()
    if key and key != rail_info.NO_KEY_SENTINEL and not token:
        raise RuntimeError(
            "Refusing to start: NEBIUS_API_KEY is set but GUARDRAILS_TOKEN is empty. "
            "Set GUARDRAILS_TOKEN (the app sends it as x-le-guard-token) or unset NEBIUS_API_KEY."
        )


check_startup()

if not (os.environ.get("NEBIUS_API_KEY") or "").strip():
    os.environ["NEBIUS_API_KEY"] = rail_info.NO_KEY_SENTINEL


def is_open(scope) -> bool:
    return scope.get("type") == "http" and scope.get("method", "GET") in ("GET", "HEAD") and scope.get("path") in OPEN_PATHS


def authorised(scope) -> bool:
    expected = (os.environ.get("GUARDRAILS_TOKEN") or "").strip()
    if not expected:
        return True  # only reachable without a model key (see check_startup): nothing to spend
    given = dict(scope.get("headers") or []).get(b"x-le-guard-token", b"")
    return hmac.compare_digest(given, expected.encode())


class LocalEditionMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            return await self.app(scope, receive, send)
        if not is_open(scope) and not authorised(scope):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
                return
            body = json.dumps({"error": "Unauthorized.", "code": "unauthorized"}).encode()
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        info = rail_info.new_request()

        async def send_with_info(message):
            if message["type"] == "http.response.start" and (info["reasons"] or info["skipped"]):
                payload = json.dumps(info, ensure_ascii=True, separators=(",", ":"))[:6000]
                message = dict(message)
                message["headers"] = list(message.get("headers") or []) + [(b"x-le-rails", payload.encode("ascii"))]
            await send(message)

        await self.app(scope, receive, send_with_info)


def init(app):
    # Starlette refuses add_middleware once the stack is built (init runs during lifespan startup),
    # so reset the cached stack; it is rebuilt, with this middleware, on the next call.
    app.middleware_stack = None
    app.add_middleware(LocalEditionMiddleware)
