#!/usr/bin/env bash
# One-command redeploy of Local Edition: D1 migrations, OpenNext build, the product Worker, the Pages front.
#
#   scripts/deploy.sh                 build the COMMITTED tree (git HEAD) in a throwaway worktree, then deploy
#   scripts/deploy.sh --tree          build the working tree as it is (uncommitted edits included)
#   scripts/deploy.sh --ref <ref>     build any commit or branch
#   scripts/deploy.sh --skip-migrate  skip `d1 migrations apply`
#   scripts/deploy.sh --only worker|pages
#
# Credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID come from the secret store (inject.sh) into a temp dir that is sourced
# and deleted at once; nothing is printed. Worker secrets (NEBIUS_API_KEY, TAVILY_API_KEY, QLOO_API_KEY, LE_JOB_SECRET) are NOT
# touched here: set them once with `wrangler secret put NAME` from a pipe. NEBIUS_SA_CREDENTIALS is never a Worker secret.
# Never run `wrangler pages project create` or `wrangler pages deploy` from inside the repo: this wrangler redirects Pages
# commands to the root wrangler.jsonc and deploys a stray Worker. The Pages front is staged in a temp dir outside the repo.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="HEAD"; TREE=0; MIGRATE=1; ONLY="all"
while [ $# -gt 0 ]; do
  case "$1" in
    --tree) TREE=1 ;;
    --ref) REF="$2"; shift ;;
    --skip-migrate) MIGRATE=0 ;;
    --only) ONLY="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/le-deploy.XXXXXX")"
cleanup() {
  [ -n "${WT:-}" ] && git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Credentials, in memory only.
"$HOME/.secret-store/inject.sh" get CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID --dir "$WORK" >/dev/null 2>&1
set -a; . "$WORK/.env.local"; set +a
rm -f "$WORK/.env.local"

if [ "$TREE" = 1 ]; then
  SRC="$REPO"
else
  WT="$WORK/src"
  git -C "$REPO" worktree add --detach "$WT" "$REF" >/dev/null 2>&1
  SRC="$WT"
  # Clone (APFS copy-on-write) the installed dependencies rather than reinstalling.
  cp -cR "$REPO/node_modules" "$SRC/node_modules" 2>/dev/null || cp -R "$REPO/node_modules" "$SRC/node_modules"
  echo "building $(git -C "$SRC" rev-parse --short HEAD) from a clean worktree"
fi
cd "$SRC"

if [ "$ONLY" = "all" ] || [ "$ONLY" = "worker" ]; then
  if [ "$MIGRATE" = 1 ]; then npx wrangler d1 migrations apply LE_DB --remote; fi
  npx opennextjs-cloudflare build
  npx wrangler deploy
fi

if [ "$ONLY" = "all" ] || [ "$ONLY" = "pages" ]; then
  STAGE="$WORK/pages"; mkdir -p "$STAGE"
  cp -R "$SRC/edge/pages/." "$STAGE/"
  # The "APP" service binding (-> Worker local-edition) is read from wrangler.toml in the staged dir.
  (cd "$STAGE" && "$SRC/node_modules/.bin/wrangler" pages deploy public --project-name localedition --branch main --commit-dirty=true)
fi

echo "deployed. verify: curl -s https://localedition.pages.dev/api/status"
