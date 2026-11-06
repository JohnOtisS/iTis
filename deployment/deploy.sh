#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="${ITIS_HOME:-$HOME/itis}"
export PATH="$ROOT/runtime/node/bin:$ROOT/runtime/postgres/bin:$PATH"
export PM2_HOME="$ROOT/run/pm2"
PM2="$ROOT/runtime/pm2/node_modules/.bin/pm2"
SHA="${1:?Full commit SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit'; exit 1; }
unset DISCORD_DEPLOY_WEBHOOK
notify(){ node --env-file="$ROOT/shared/deploy.env" "$ROOT/deployment/notify.mjs" "$@"; }
ITIS_PUBLIC_URL="$(node --env-file="$ROOT/shared/deploy.env" -e 'process.stdout.write(process.env.ITIS_PUBLIC_URL)')"
RELEASE="$ROOT/releases/$SHA"
PREVIOUS="$(readlink -e "$ROOT/current" 2>/dev/null || true)"
SWITCHED=0
fail(){
  code=$?
  if [ "$SWITCHED" = 1 ] && [ -n "$PREVIOUS" ]; then ln -sfn "$PREVIOUS" "$ROOT/current"; "$PM2" restart itis-web --update-env || true; fi
  notify "🔴 iTis deploy thất bại: ${SHA:0:8}. Bản trước được giữ/khôi phục; xem log server."
  exit "$code"
}
trap fail ERR
notify "🟡 iTis đang deploy commit ${SHA:0:8}."
if [ ! -d "$RELEASE" ]; then mkdir -p "$RELEASE"; git -C "$ROOT/repository" archive "$SHA" | tar -x -C "$RELEASE"; fi
cd "$RELEASE"
export NODE_OPTIONS="--max-old-space-size=2048"
npm ci --no-audit --no-fund > "$ROOT/logs/install-$SHA.log" 2>&1
npm run build:local > "$ROOT/logs/build-$SHA.log" 2>&1
set -a; source "$ROOT/shared/database.env"; set +a
pg_dump --format=custom --file="$ROOT/backups/predeploy-$(date -u +%Y%m%dT%H%M%S)-${SHA:0:8}.dump"
node scripts/migrate.mjs
unset MIGRATION_DATABASE_URL PGPASSWORD PGUSER PGDATABASE PGHOST PGPORT
printf '%s\n' "$SHA" > "$RELEASE/.release-sha"
ln -sfn "$RELEASE" "$ROOT/current"
SWITCHED=1
"$PM2" startOrRestart "$ROOT/deployment/ecosystem.config.cjs" --only itis-web --update-env
for attempt in $(seq 1 40); do
  if curl --fail --silent http://127.0.0.1:15173/api/health | grep -q "$SHA"; then
    "$PM2" save > /dev/null
    printf '%s\n' "$SHA" > "$ROOT/shared/deployed-sha"
    SWITCHED=0
    if ! bash "$ROOT/deployment/prune-releases.sh" "$ROOT" "$PREVIOUS"; then
      echo 'Release cleanup failed. The healthy release stays active.' >&2
    fi
    notify "🟢 iTis deploy nội bộ thành công commit ${SHA:0:8}; health check đạt. Địa chỉ public cấu hình: ${ITIS_PUBLIC_URL}; khả năng truy cập Internet cần được kiểm tra riêng." || echo 'Unable to send deployment notification.' >&2
    exit 0
  fi
  sleep 1
done
echo 'New release failed health check'; false
