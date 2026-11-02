#!/usr/bin/env bash
set -euo pipefail
ROOT="${ITIS_HOME:-$HOME/itis}"
flock -n "$ROOT/run/ensure.lock" bash "$ROOT/deployment/ensure-services.sh"
bash "$ROOT/deployment/watch.sh"
