ALTER TABLE messages ADD COLUMN memory_notice text;
--> statement-breakpoint
ALTER TABLE user_memories ADD COLUMN revisions jsonb NOT NULL DEFAULT '[]'::jsonb;
