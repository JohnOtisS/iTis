ALTER TABLE users ADD COLUMN last_seen_at timestamptz;
CREATE TABLE password_resets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);
CREATE TABLE auth_rate_windows (key text PRIMARY KEY, hits integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL);
CREATE INDEX auth_rate_expiry_idx ON auth_rate_windows(expires_at);
CREATE TABLE notification_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 kind text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient text NOT NULL, status text NOT NULL DEFAULT 'queued',
 encrypted_payload text, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, provider_id text, error text, sent_at timestamptz, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(campaign_id,user_id)
);
CREATE INDEX notification_delivery_queue_idx ON notification_deliveries(status,next_attempt_at);
CREATE INDEX notification_delivery_user_idx ON notification_deliveries(user_id,created_at);
