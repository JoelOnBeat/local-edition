#!/usr/bin/env bash
# Pushes every Worker secret that is in the secret store and not yet on the Worker. Run it again whenever a value appears.
#   scripts/deploy-secrets.sh            put only the missing ones
#   scripts/deploy-secrets.sh --force    put every one that is in the secret store (rotation)
# Values travel secret store -> pipe -> `wrangler secret put`; nothing is printed or written into the repo.
# Not here on purpose: NEBIUS_SA_CREDENTIALS (never a Worker secret), SQUARE_WEBHOOK_SIGNATURE_KEY (scripts/square-webhook.ts),
# COMPOSIO_WEBHOOK_SECRET (waits on a decision), LE_JOB_SECRET (set once at first deploy; rotating it needs a runner restart).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/le-secrets.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# "secret store name:worker secret name"
PAIRS="NEBIUS_API_KEY:NEBIUS_API_KEY TAVILY_API_KEY:TAVILY_API_KEY QLOO_API_KEY:QLOO_API_KEY
LOCALEDITION_SQUARE_ACCESS_TOKEN:SQUARE_ACCESS_TOKEN LOCALEDITION_SQUARE_APP_ID:SQUARE_APP_ID LOCALEDITION_SQUARE_APP_SECRET:SQUARE_APP_SECRET LOCALEDITION_SQUARE_TOKEN_KEY:SQUARE_TOKEN_KEY
LOCALEDITION_SLACK_BOT_TOKEN:SLACK_BOT_TOKEN LOCALEDITION_SLACK_SIGNING_SECRET:SLACK_SIGNING_SECRET LOCALEDITION_SLACK_CLIENT_ID:SLACK_CLIENT_ID LOCALEDITION_SLACK_CLIENT_SECRET:SLACK_CLIENT_SECRET
COMPOSIO_API_KEY:COMPOSIO_API_KEY LOCALEDITION_COMMS_ENC_KEY:COMMS_ENC_KEY"

# The token-encryption key (AES-256, base64 of 32 bytes) is generated into the secret store the first time, never printed.
if ~/.secret-store/inject.sh has LOCALEDITION_SQUARE_TOKEN_KEY 2>&1 | grep -q "not found"; then
  K="$(openssl rand -base64 32)"; printf '%s\n' "$K" | ~/.secret-store/scripts/set-keys.py LOCALEDITION_SQUARE_TOKEN_KEY >/dev/null 2>&1; unset K
  echo "generated LOCALEDITION_SQUARE_TOKEN_KEY into the secret store"
fi

NAMES=""; for p in $PAIRS; do NAMES="$NAMES ${p%%:*}"; done
~/.secret-store/inject.sh get CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID $NAMES --dir "$WORK" >/dev/null 2>&1 || true
set -a; . "$WORK/.env.local"; set +a
rm -f "$WORK/.env.local"

cd "$REPO"
HAVE="$(npx wrangler secret list 2>/dev/null | grep '"name"' | sed 's/.*: "\(.*\)".*/\1/' || true)"
for p in $PAIRS; do
  v="${p%%:*}"; w="${p##*:}"
  val="${!v:-}"
  if [ -z "$val" ]; then echo "$w: not in the secret store yet"; continue; fi
  if [ "$FORCE" = 0 ] && echo "$HAVE" | grep -qx "$w"; then echo "$w: already set"; continue; fi
  if printf '%s' "$val" | npx wrangler secret put "$w" >/dev/null 2>&1; then echo "$w: set"; else echo "$w: FAILED"; fi
done
