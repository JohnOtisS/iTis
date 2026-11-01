ALTER TABLE users ALTER COLUMN token_limit SET DEFAULT 100000;
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN total_token_limit SET DEFAULT 1000000;
--> statement-breakpoint
-- Move only the previous stock Standard plan; retain custom grants and usage.
UPDATE users SET token_limit=100000,total_token_limit=1000000,updated_at=now()
WHERE role='standard' AND token_limit=250000 AND total_token_limit=3000000
AND unlimited=false AND total_unlimited=false
AND (SELECT value->'standard' FROM app_settings WHERE key='role_limits') =
'{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false}'::jsonb;
--> statement-breakpoint
INSERT INTO app_settings(key,value) VALUES ('role_limits',
'{"standard":{"cycleTokens":100000,"cycleUnlimited":false,"totalTokens":1000000,"totalUnlimited":false},"plus":{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false},"admin":{"cycleTokens":2000000,"cycleUnlimited":true,"totalTokens":0,"totalUnlimited":true}}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=jsonb_set(app_settings.value,'{standard}',excluded.value->'standard'),updated_at=now()
WHERE app_settings.value->'standard'='{"cycleTokens":250000,"cycleUnlimited":false,"totalTokens":3000000,"totalUnlimited":false}'::jsonb;
