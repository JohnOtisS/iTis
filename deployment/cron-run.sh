#!/usr/bin/env bash
set -euo pipefail
ROOT="${ITIS_HOME:-$HOME/itis}"
flock -n "$ROOT/run/ensure.lock" bash "$ROOT/deployment/ensure-services.sh"
if [ -f "$ROOT/current/scripts/email-worker.mjs" ]; then
  ( set -a; source "$ROOT/shared/runtime.env"; set +a
    "$ROOT/runtime/node/bin/node" "$ROOT/current/scripts/email-worker.mjs" >> "$ROOT/logs/email.log" 2>&1
  ) &
fi
bash "$ROOT/deployment/watch.sh"
