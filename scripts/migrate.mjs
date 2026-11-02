import nextEnv from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.MIGRATION_DATABASE_URL && !process.env.DATABASE_URL) throw new Error("A migration database URL is required before starting iTis.");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle-pg" });
  console.log("Database migrations ready.");
} finally { await pool.end(); }
