import Redis from "ioredis";

declare global {
  var __itisRedis: Redis | undefined;
}

export function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalThis.__itisRedis) {
    globalThis.__itisRedis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 1000,
      retryStrategy: (attempt) => attempt <= 1 ? 250 : null,
    });
    // Requests fall back to PostgreSQL; avoid unhandled client error events.
    globalThis.__itisRedis.on("error", () => {});
  }
  return globalThis.__itisRedis;
}
