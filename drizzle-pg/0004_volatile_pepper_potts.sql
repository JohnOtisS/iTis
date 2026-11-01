ALTER TABLE "users" ADD COLUMN "total_token_limit" bigint DEFAULT 10000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "total_unlimited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "users" SET "total_token_limit" = 100000000 WHERE "role" = 'plus';--> statement-breakpoint
UPDATE "users" SET "total_token_limit" = 0, "total_unlimited" = true WHERE "role" = 'admin';
