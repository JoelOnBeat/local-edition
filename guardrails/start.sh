#!/usr/bin/env bash
# Local start: installs pinned dependencies with uv (first run only) and serves the rails on :8000.
#   NEBIUS_API_KEY     optional. Without it the brand-voice rail reports "skipped"; the regex rail still runs.
#   GUARDRAILS_TOKEN   shared secret; every path but GET /v1/health then needs the x-le-guard-token header.
#                      REQUIRED when NEBIUS_API_KEY is set: the server refuses to start without it.
#   PORT               default 8000.
set -euo pipefail
cd "$(dirname "$0")"
UV="${UV:-$(command -v uv || echo "$HOME/.local/bin/uv")}"
"$UV" sync --python 3.11 --frozen --no-dev
exec "$UV" run --no-dev nemoguardrails server \
  --config . \
  --port "${PORT:-8000}" \
  --default-config-id localedition \
  --disable-chat-ui
