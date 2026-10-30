#!/usr/bin/env bash
# Starts the Local Edition LoRA fine-tune as ONE Nebius Serverless Job (1x H100, eu-north1), watches it, prints its log and
# deletes it. Usage:  NEBIUS_API_KEY=... scripts/start-finetune.sh [--dry-run]
# The key reaches the job only as an injected secret file (never an environment variable, never an argument). Session-only:
# it uses `nebius --profile hackathon-jobs-sa`; no profile-showing command is run and no token is printed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NEBIUS="${NEBIUS:-$HOME/.local/bin/nebius}"
PROJECT="project-e00fwfe5pr00k4s8jdngz0"          # eu-north1, H100 quota
IMAGE="pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime"  # Docker Hub
PLATFORM="gpu-h100-sxm"; PRESET="1gpu-16vcpu-200gb"
H100_USD_PER_HOUR="4.50"                           # docs.nebius.com/compute/resources/pricing, on-demand
MAX_WALL_MIN="${MAX_WALL_MIN:-44}"                 # cancel here: 44 min x $4.50/h = $3.30, under the $3.50 cap
NAME=""
DRY="${1:-}"
[ -n "${NEBIUS_API_KEY:-}" ] || { echo "NEBIUS_API_KEY must be set in the environment (not printed)." >&2; exit 2; }

WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
python3 - "$HERE" "$WORK" <<'PY'
import gzip, json, sys
here, work = sys.argv[1], sys.argv[2]
files = {f"{n}": open(f"{here}/finetune/{n}", encoding="utf-8").read() for n in ("spec.py", "rules.py", "gen_data.py", "train_eval.py", "requirements.txt")}
files["catalogue.py"] = open(f"{here}/guardrails/localedition/catalogue.py", encoding="utf-8").read()  # the app's own rule catalogue
import base64
open(f"{work}/bundle.b64", "w").write(base64.b64encode(gzip.compress(json.dumps(files).encode(), 9)).decode())  # text, so any injector can carry it
PY
cp "$HERE/finetune/run.sh" "$WORK/run.sh"
printf '%s' "$NEBIUS_API_KEY" > "$WORK/NEBIUS_API_KEY"
echo "pack $(stat -f%z "$WORK/bundle.b64" 2>/dev/null || stat -c%s "$WORK/bundle.b64") bytes base64; job $NAME; $PLATFORM $PRESET; image $IMAGE; wall cap ${MAX_WALL_MIN} min"

build_args() { NAME="local-edition-finetune-$(date -u +%Y%m%d%H%M%S)"; ARGS=(ai job create --parent-id "$PROJECT" --name "$NAME" --image "$IMAGE" --platform "$PLATFORM" --preset "$PRESET"
  --disk-size 100Gi --timeout 1h --restart-policy never --working-dir /opt/le --container-command bash --args "/opt/le/run.sh"
  --env PYTHONUNBUFFERED=1
  --inject-file "$WORK/run.sh:/opt/le/run.sh" --inject-file "$WORK/bundle.b64:/opt/le/bundle.b64"
  --inject-file "$WORK/NEBIUS_API_KEY:/opt/le-secrets/NEBIUS_API_KEY"); }
build_args
if [ "$DRY" = "--dry-run" ]; then "$NEBIUS" --profile hackathon-jobs-sa "${ARGS[@]}" --dry-run --format json >/dev/null && echo "dry run accepted: nothing created."; exit 0; fi

# The tenant allows 2 concurrent instances (any job, any project): while other products' jobs hold both slots, creation
# answers ResourceExhausted, or the job is created and then ends in ERROR while still provisioning (quota). Both create
# nothing billable; delete the empty job and retry every 20 s for up to QUEUE_MIN minutes. Any other failure stops.
QUEUE_MIN="${QUEUE_MIN:-45}"; Q0=$(date +%s); JOB_ID=""; STATE=""; T0=0
delete_job() { "$NEBIUS" --profile hackathon-jobs-sa ai job delete "$1" --async >/dev/null 2>&1 && echo "delete requested for $1" || echo "DELETE FAILED: nebius --profile hackathon-jobs-sa ai job delete $1"; }
trap 'rm -rf "$WORK"; [ -n "$JOB_ID" ] && delete_job "$JOB_ID"' EXIT
while true; do
  [ $(( $(date +%s) - Q0 )) -lt $(( QUEUE_MIN * 60 )) ] || { echo "gave up waiting for an instance slot" >&2; exit 1; }
  build_args  # a fresh unique job name per attempt
  if ! OUT="$("$NEBIUS" --profile hackathon-jobs-sa "${ARGS[@]}" --async --format 'jsonpath={.resource_id}' 2>&1)"; then
    if [[ "$OUT" == *ResourceExhausted* ]]; then sleep 20; continue; fi
    echo "create failed: $(echo "$OUT" | head -n 3)" >&2; exit 1
  fi
  JOB_ID="$(echo "$OUT" | grep -o "aijob-[a-z0-9]*" | tail -n 1)"; [ -n "$JOB_ID" ] || { echo "no job id in: $OUT" >&2; exit 1; }
  T0=$(date +%s); LAST=""; RAN=0
  echo "created $NAME id=$JOB_ID at $(date '+%H:%M:%S %Z') after $(( T0 - Q0 )) s in the queue"
  while true; do
    STATE="$("$NEBIUS" --profile hackathon-jobs-sa ai job get "$JOB_ID" --format 'jsonpath={.status.state}' 2>/dev/null || echo UNKNOWN)"
    [ "$STATE" != "$LAST" ] && { echo "[$(( $(date +%s) - T0 ))s] state $STATE"; LAST="$STATE"; }
    [ "$STATE" = "RUNNING" ] && RAN=1
    case "$STATE" in COMPLETED|FAILED|CANCELLED|ERROR) break;; esac
    if [ $(( $(date +%s) - T0 )) -gt $(( MAX_WALL_MIN * 60 )) ]; then
      echo "wall cap reached: cancelling to stay under the GPU budget"; "$NEBIUS" --profile hackathon-jobs-sa ai job cancel "$JOB_ID" >/dev/null 2>&1 || true; STATE="CAPPED"; break
    fi
    sleep 15
  done
  if [ "$STATE" = "ERROR" ] && [ "$RAN" = 0 ]; then echo "provisioning failed (quota); retrying"; delete_job "$JOB_ID"; JOB_ID=""; sleep 20; continue; fi
  break
done
WALL=$(( $(date +%s) - T0 ))
echo "----- job logs -----"; "$NEBIUS" --profile hackathon-jobs-sa ai job logs "$JOB_ID" 2>&1 | python3 -c 'import os,sys; k=os.environ.get("NEBIUS_API_KEY",""); t=sys.stdin.read(); print(t.replace(k,"[redacted]") if len(k)>=8 else t)'
echo "----- end logs -----"
python3 -c "print('job %s (%s) ended %s after %d s; upper-bound GPU cost \$%.2f at \$$H100_USD_PER_HOUR/h' % ('$JOB_ID','$NAME','$STATE',$WALL,$WALL/3600*$H100_USD_PER_HOUR))"
[ "$STATE" = "COMPLETED" ]
