import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __itisPostgresPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL chưa được cấu hình cho PostgreSQL local.");
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDb() {
  const pool = globalThis.__itisPostgresPool ?? createPool();
  globalThis.__itisPostgresPool = pool;
  return drizzle(pool, { schema });
}
