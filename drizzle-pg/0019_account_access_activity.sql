ALTER TABLE users ADD COLUMN access_expires_at timestamptz,
  ADD COLUMN active_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN activity_ping_at timestamptz;
--> statement-breakpoint
CREATE TABLE account_token_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX account_token_grants_user_idx ON account_token_grants(user_id);
