# Standalone production deployment

All iTis processes, releases and data live under the dedicated Unix account's
`$HOME/itis`, separate from other sites.

- PostgreSQL 16 / pgvector: `127.0.0.1:15432`, database `itis_production`.
- `itis_owner` performs migrations; `itis_app` is the limited runtime role.
- Redis: `127.0.0.1:16379`, authenticated and private to the host.
- Next.js production: `127.0.0.1:15173`; an administrator configures the IP vhost
  using `nginx-ip.conf`. TCP 80 is the intended public entry point.
- File/branding/avatar directories and the database stay outside release folders.
- PM2 restarts the web worker. The account's crontab runs `cron-run.sh` every
  minute and after reboot, preserving unrelated existing cron entries.

The public GitHub repository needs no server SSH key or database/API credential.
GitHub Actions runs lint/build for pushes to main. The server fetches main every
minute, verifies a successful `iTis CI` run for the exact SHA, builds an isolated
release, saves a pre-migration database dump, applies migrations and switches the
current symlink. A failed health check restores the previous code release.
Database migrations are not automatically downgraded; design them compatibly.

Discord receives start/success/failure status from the server. Its webhook and
all provider/database credentials live in mode-0600 `shared/*.env` files, outside
the checkout. No secrets are required in the public GitHub workflow.

Initial browser-based source synchronization uses a temporary bootstrap workflow.
After the verified source is committed, it replaces itself with read-only CI and
dispatches a normal CI run. No bootstrap patch remains on the final branch.

HTTP is explicitly selected for the initial IP-only deployment. The server sets
`SESSION_COOKIE_SECURE=false` for this mode. Once HTTPS is installed, remove that
override and update `ITIS_PUBLIC_URL`; HTTP login traffic is not encrypted.

Initial administrator seeding is a one-time action. Do not run seed on later
deployments, because it can reset administrator credentials. Local accounts and
history are not imported into the fresh production database.

Production backup dumps are outside the checkout. Copy recovery sets, file
storage and the stable memory key to an independent backup destination and verify
a restore before relying on them. Local dumps do not protect against disk loss.
