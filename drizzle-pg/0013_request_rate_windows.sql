CREATE TABLE request_rate_windows (
  key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hits integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX request_rate_windows_expires_idx ON request_rate_windows(expires_at);
