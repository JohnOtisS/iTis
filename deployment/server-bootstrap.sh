#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="${ITIS_HOME:-$HOME/itis}"
PG_VERSION="${PG_VERSION:-16.15}"
NODE_VERSION="${NODE_VERSION:-v22.23.4}"
REDIS_VERSION="${REDIS_VERSION:-7.4.12}"
mkdir -p "$ROOT"/{runtime,build,shared,logs,releases,backups,storage/{files,generated,avatars,branding},data/{postgres,redis},run}
cd "$ROOT/build"
if [ ! -x "$ROOT/runtime/node/bin/node" ]; then
  file="node-$NODE_VERSION-linux-x64.tar.xz"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/$file" -o "$file"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o node-checksums.txt
  grep " $file\$" node-checksums.txt | sha256sum --check -
  tar -xf "$file"; mv "node-$NODE_VERSION-linux-x64" "$ROOT/runtime/node"
fi
if [ ! -x "$ROOT/runtime/postgres/bin/postgres" ]; then
  file="postgresql-$PG_VERSION.tar.bz2"
  curl --fail --silent --show-error --location "https://ftp.postgresql.org/pub/source/v$PG_VERSION/$file" -o "$file"
  curl --fail --silent --show-error --location "https://ftp.postgresql.org/pub/source/v$PG_VERSION/$file.sha256" -o pg-checksum.txt
  sha256sum --check pg-checksum.txt
  tar -xf "$file"; cd "postgresql-$PG_VERSION"
  ./configure --prefix="$ROOT/runtime/postgres" --without-readline --without-icu --without-zlib > "$ROOT/logs/postgres-configure.log" 2>&1
  nice -n 10 make -j2 > "$ROOT/logs/postgres-build.log" 2>&1
  make install >> "$ROOT/logs/postgres-build.log" 2>&1
  cd "$ROOT/build"
fi
export PATH="$ROOT/runtime/postgres/bin:$ROOT/runtime/node/bin:$PATH"
if [ ! -f "$ROOT/runtime/postgres/share/extension/vector.control" ]; then
  if [ ! -d pgvector ]; then git clone --depth 1 --branch v0.8.1 https://github.com/pgvector/pgvector.git pgvector; fi
  cd pgvector
  nice -n 10 make -j2 PG_CONFIG="$ROOT/runtime/postgres/bin/pg_config" OPTFLAGS="" > "$ROOT/logs/pgvector-build.log" 2>&1
  make install PG_CONFIG="$ROOT/runtime/postgres/bin/pg_config" >> "$ROOT/logs/pgvector-build.log" 2>&1
  cd "$ROOT/build"
fi
if [ ! -x "$ROOT/runtime/redis/bin/redis-server" ]; then
  file="redis-$REDIS_VERSION.tar.gz"
  curl --fail --silent --show-error --location "https://download.redis.io/releases/$file" -o "$file"
  tar -xf "$file"; cd "redis-$REDIS_VERSION"
  nice -n 10 make -j2 MALLOC=libc > "$ROOT/logs/redis-build.log" 2>&1
  make PREFIX="$ROOT/runtime/redis" install >> "$ROOT/logs/redis-build.log" 2>&1
  cd "$ROOT/build"
fi
echo "Runtime ready: Node $(node --version), PostgreSQL $(postgres --version), Redis $REDIS_VERSION"
