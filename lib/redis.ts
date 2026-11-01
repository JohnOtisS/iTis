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
    });
  }
  return globalThis.__itisRedis;
}
