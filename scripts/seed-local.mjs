import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const email = (process.env.ADMIN_EMAIL || "admin@itis.local").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || "Admin iTis").trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is required");
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `insert into users (email, name, password_hash, role, token_limit, unlimited, total_token_limit, total_unlimited, reset_window_hours, is_active)
     values ($1, $2, $3, 'admin', 2000000, true, 0, true, 5, true)
     on conflict (email) do update set
       name = excluded.name,
       password_hash = excluded.password_hash,
       role = 'admin',
       unlimited = true,
       total_unlimited = true,
       is_active = true,
       updated_at = now()`,
    [email, name, passwordHash],
  );

  await pool.query(
    `insert into app_settings (key, value)
     values
       ('ai_environment', '{"provider":"openai"}'::jsonb),
       ('role_limits', '{"standard":{"cycleTokens":100000,"cycleUnlimited":false,"totalTokens":1000000,"totalUnlimited":false},"plus":{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false},"admin":{"cycleTokens":2000000,"cycleUnlimited":true,"totalTokens":0,"totalUnlimited":true}}'::jsonb),
       ('token_reset', '{"windowHours":5}'::jsonb),
       ('model_router', '{"lunaPercent":80,"solPercent":20,"enabled":true}'::jsonb),
       ('conversation_limits', '{"maxContextTokens":50000}'::jsonb)
     on conflict (key) do nothing`,
  );

  console.log(`Seeded local admin: ${email}`);
} finally {
  await pool.end();
}
