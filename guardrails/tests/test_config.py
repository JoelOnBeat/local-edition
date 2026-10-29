import asyncio
import importlib.util
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_KEYS = ("NEBIUS_API_KEY", "GUARDRAILS_TOKEN")


@pytest.fixture()
def config(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    spec = importlib.util.spec_from_file_location("le_config", os.path.join(HERE, "..", "config.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for k in ENV_KEYS:  # the import installs a sentinel key; start every test clean
        monkeypatch.delenv(k, raising=False)
    return module


def call(config, path, method="GET", token=None, scope_type="http"):
    """Drive the middleware once. Returns (status, reached_app)."""
    reached = []
    sent = []

    async def app(scope, receive, send):
        reached.append(scope["path"])
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def send(message):
        sent.append(message)

    headers = [(b"x-le-guard-token", token.encode())] if token is not None else []
    scope = {"type": scope_type, "path": path, "method": method, "headers": headers}
    asyncio.run(config.LocalEditionMiddleware(app)(scope, None, send))
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    return status, bool(reached)


def test_refuses_to_start_with_a_key_and_no_token(config):
    with pytest.raises(RuntimeError, match="GUARDRAILS_TOKEN"):
        config.check_startup({"NEBIUS_API_KEY": "real-looking-key"})
    with pytest.raises(RuntimeError):
        config.check_startup({"NEBIUS_API_KEY": "real-looking-key", "GUARDRAILS_TOKEN": "  "})


def test_starts_with_a_token_or_without_a_key(config):
    config.check_startup({"NEBIUS_API_KEY": "real-looking-key", "GUARDRAILS_TOKEN": "t" * 32})
    config.check_startup({})
    config.check_startup({"NEBIUS_API_KEY": config.rail_info.NO_KEY_SENTINEL})


def test_importing_with_a_key_and_no_token_fails(monkeypatch):
    monkeypatch.setenv("NEBIUS_API_KEY", "real-looking-key")
    monkeypatch.delenv("GUARDRAILS_TOKEN", raising=False)
    spec = importlib.util.spec_from_file_location("le_config_bad", os.path.join(HERE, "..", "config.py"))
    module = importlib.util.module_from_spec(spec)
    with pytest.raises(RuntimeError):
        spec.loader.exec_module(module)


@pytest.mark.parametrize("path", ["/v1/checks", "/v1/chat/completions", "/v1/models", "/docs", "/openapi.json", "/", "/v1/health/x", "/anything"])
def test_every_path_but_health_needs_the_token(config, monkeypatch, path):
    monkeypatch.setenv("GUARDRAILS_TOKEN", "s3cret-token-for-tests")
    assert call(config, path) == (401, False)
    assert call(config, path, token="wrong") == (401, False)
    assert call(config, path, token="s3cret-token-for-tests") == (200, True)
    assert call(config, path, method="POST") == (401, False)


def test_health_stays_open_for_get_only(config, monkeypatch):
    monkeypatch.setenv("GUARDRAILS_TOKEN", "s3cret-token-for-tests")
    assert call(config, "/v1/health") == (200, True)
    assert call(config, "/v1/health", method="POST") == (401, False)


def test_websockets_without_the_token_are_closed(config, monkeypatch):
    monkeypatch.setenv("GUARDRAILS_TOKEN", "s3cret-token-for-tests")
    sent = []

    async def send(message):
        sent.append(message)

    asyncio.run(config.LocalEditionMiddleware(None)({"type": "websocket", "path": "/ws", "headers": []}, None, send))
    assert sent == [{"type": "websocket.close", "code": 4401}]
