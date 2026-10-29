"""Server init for the NeMo Guardrails app (loaded by `nemoguardrails server --config guardrails`).

Adds one ASGI middleware around POST /v1/checks:
  1. optional shared-secret auth: if GUARDRAILS_TOKEN is set, the header `x-le-guard-token` must match
     (the stock server has no auth, and the brand-voice rail spends the model key);
  2. attaches the rails' reasons and skipped checks as the `x-le-rails` response header (JSON).
"""

from __future__ import annotations

import hmac
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "localedition"))

import rail_info  # noqa: E402

if not (os.environ.get("NEBIUS_API_KEY") or "").strip():
    os.environ["NEBIUS_API_KEY"] = rail_info.NO_KEY_SENTINEL

PROTECTED = ("/v1/checks", "/v1/chat/completions")


class LocalEditionMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") not in PROTECTED:
            return await self.app(scope, receive, send)

        expected = os.environ.get("GUARDRAILS_TOKEN", "")
        if expected:
            given = dict(scope.get("headers") or []).get(b"x-le-guard-token", b"").decode("latin-1")
            if not hmac.compare_digest(given.encode(), expected.encode()):
                body = json.dumps({"error": "Unauthorized.", "code": "unauthorized"}).encode()
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return

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
