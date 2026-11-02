#!/usr/bin/env bash
set -euo pipefail
ROOT="${ITIS_HOME:-$HOME/itis}"
set -a; source "$ROOT/shared/runtime.env"; set +a
export PATH="$ROOT/runtime/node/bin:$PATH"
export ITIS_RELEASE_SHA="$(cat "$ROOT/current/.release-sha")"
cd "$ROOT/current"
exec node node_modules/next/dist/bin/next start -H "${ITIS_BIND_HOST:-127.0.0.1}" -p "${ITIS_PORT:-15173}"
