ALTER TABLE "users" ALTER COLUMN "total_token_limit" SET DEFAULT 3000000;
--> statement-breakpoint
-- Apply the selected onboarding plan once. Existing account-specific grants,
-- usage records and storage allocations are intentionally preserved.
INSERT INTO app_settings(key,value) VALUES
('role_limits', '{"standard":{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false},"plus":{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false},"admin":{"cycleTokens":2000000,"cycleUnlimited":true,"totalTokens":0,"totalUnlimited":true}}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value = jsonb_set(jsonb_set(app_settings.value, '{standard}', excluded.value->'standard'), '{plus}', excluded.value->'plus'), updated_at=now();
--> statement-breakpoint
INSERT INTO app_settings(key,value) VALUES
('conversation_limits','{"maxContextTokens":50000}'::jsonb),
('token_reset','{"windowHours":5}'::jsonb),
('model_router','{"enabled":true,"lunaPercent":80,"solPercent":20}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now();
--> statement-breakpoint
INSERT INTO app_settings(key,value) VALUES ('ai_environment','{"provider":"openai"}'::jsonb) ON CONFLICT DO NOTHING;
