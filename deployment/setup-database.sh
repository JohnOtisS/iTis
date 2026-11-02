#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="${ITIS_HOME:-$HOME/itis}"
export PATH="$ROOT/runtime/postgres/bin:$ROOT/runtime/node/bin:$ROOT/runtime/redis/bin:$PATH"
if [ ! -f "$ROOT/data/postgres/PG_VERSION" ]; then
  initdb -D "$ROOT/data/postgres" --encoding=UTF8 --locale=C.UTF-8 --auth-local=peer --auth-host=scram-sha-256 > "$ROOT/logs/initdb.log"
  cat >> "$ROOT/data/postgres/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 15432
unix_socket_directories = '$ROOT/run'
shared_buffers = '128MB'
max_connections = 30
log_statement = 'none'
log_min_error_statement = 'panic'
EOF
fi
if ! pg_ctl -D "$ROOT/data/postgres" status >/dev/null 2>&1; then pg_ctl -D "$ROOT/data/postgres" -l "$ROOT/logs/postgres.log" -w start; fi
set -a; source "$ROOT/shared/runtime.env"; source "$ROOT/shared/database.env"; set +a
APP_PASSWORD="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).password)')"
psql -X -h "$ROOT/run" -p 15432 -U "$(id -un)" -d postgres -v ON_ERROR_STOP=1 <<EOF
DO \$\$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='itis_owner') THEN CREATE ROLE itis_owner LOGIN PASSWORD '$PGPASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='itis_app') THEN CREATE ROLE itis_app LOGIN PASSWORD '$APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END \$\$;
SELECT 'CREATE DATABASE itis_production OWNER itis_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='itis_production')\gexec
EOF
psql -X -h "$ROOT/run" -p 15432 -U "$(id -un)" -d itis_production -v ON_ERROR_STOP=1 <<'EOF'
CREATE EXTENSION IF NOT EXISTS vector;
REVOKE ALL ON DATABASE itis_production FROM PUBLIC;
GRANT CONNECT ON DATABASE itis_production TO itis_owner,itis_app;
GRANT USAGE ON SCHEMA public TO itis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE itis_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO itis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE itis_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO itis_app;
EOF
cat > "$ROOT/shared/redis.conf" <<EOF
bind 127.0.0.1
port 16379
protected-mode yes
requirepass $ITIS_REDIS_PASSWORD
daemonize yes
pidfile $ROOT/run/redis.pid
dir $ROOT/data/redis
logfile $ROOT/logs/redis.log
appendonly yes
maxmemory 128mb
maxmemory-policy noeviction
EOF
export REDISCLI_AUTH="$ITIS_REDIS_PASSWORD"
if ! redis-cli -h 127.0.0.1 -p 16379 ping >/dev/null 2>&1; then redis-server "$ROOT/shared/redis.conf"; fi
unset REDISCLI_AUTH APP_PASSWORD
echo 'Production PostgreSQL database and Redis ready on loopback only.'
