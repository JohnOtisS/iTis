#!/usr/bin/env bash
set -euo pipefail
ROOT="${ITIS_HOME:-$HOME/itis}"
export PATH="$ROOT/runtime/node/bin:$PATH"
set -a; source "$ROOT/shared/deploy.env"; set +a
exec flock -n "$ROOT/run/deploy.lock" node "$ROOT/deployment/watch.mjs"
