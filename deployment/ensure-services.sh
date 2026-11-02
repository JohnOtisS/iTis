#!/usr/bin/env bash
set -euo pipefail
ROOT="${ITIS_HOME:-$HOME/itis}"
export PATH="$ROOT/runtime/node/bin:$ROOT/runtime/postgres/bin:$ROOT/runtime/redis/bin:$PATH"
export PM2_HOME="$ROOT/run/pm2"
PM2="$ROOT/runtime/pm2/node_modules/.bin/pm2"
if ! pg_ctl -D "$ROOT/data/postgres" status >/dev/null 2>&1; then pg_ctl -D "$ROOT/data/postgres" -l "$ROOT/logs/postgres.log" -w start; fi
set -a; source "$ROOT/shared/runtime.env"; set +a
export REDISCLI_AUTH="${ITIS_REDIS_PASSWORD:?}"
if ! redis-cli -h 127.0.0.1 -p 16379 ping >/dev/null 2>&1; then redis-server "$ROOT/shared/redis.conf"; fi
unset REDISCLI_AUTH
if [ -L "$ROOT/current" ] && ! "$PM2" describe itis-web >/dev/null 2>&1; then "$PM2" start "$ROOT/deployment/ecosystem.config.cjs"; "$PM2" save; fi
