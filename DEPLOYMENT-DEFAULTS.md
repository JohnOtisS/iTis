# iTis deployment defaults

New Standard accounts start with 100,000 tokens per 5-hour rolling window and
a 1,000,000-token total allocation. Plus accounts start with 250,000 tokens per
5 hours and 3,000,000 total tokens. Both have 2 GiB of storage. Admin accounts
retain their unlimited token permissions. New chats have a 50,000-token session
limit. Luna/Sol automatic routing remains enabled; 80/20 is a configured target,
not an enforced split or a guaranteed bill.

The total allocation does **not** automatically renew monthly. A planning budget
of VND 100,000–150,000 per person/month is **not** a currency spending cap.
Actual charges depend on model, input/output, cache, tools and provider prices.

Admin > Users can override each account. Admin > token plans controls defaults
used by both the account creation form and API. Plan saves update accounts whose
four quota fields still match their previous role plan; differing individual
allocations are preserved. Accounts matching a plan exactly are treated as inheriting
it (there is no separate inheritance flag).

Migration 0009 installs the chosen global defaults once and preserves existing
per-account grants, spent tokens, account storage quotas and history. Later
server restarts do not reset administrator edits. Seed uses ON CONFLICT DO
NOTHING for settings.

Migration 0011 splits the former stock Standard/Plus plans. Only Standard accounts
and settings still matching the old 250K/3M stock plan move to 100K/1M. Existing
usage is never reset; an account already above its new quota must receive an admin
grant before sending more requests. Custom plans/allocations remain unchanged.

## Starting a deployed Next.js server

Set DATABASE_URL, OPENAI_API_KEY and other required environment variables.
Provision the initial administrator separately using the existing seed command
and ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD. Do not run seed automatically
on every restart, as it updates the initial admin credentials.

Build with `npm run build:local`, then start with `npm run start:local`, or use
the existing Dockerfile.local / `npm run start:docker` flow. Both production
start scripts run database migrations first. A new database therefore receives
the default plan without needing to open the admin page. Database migration
failures prevent startup.

Custom hosting entrypoints must execute `node scripts/migrate.mjs` before
starting Next.js. The migration step requires the drizzle-pg folder and runtime
dependencies to be present. Existing file storage needs its persistent volume;
run `npm run storage:reconcile` after importing an older database/storage set.

Storage quota measures logical history content and registered files, not total
PostgreSQL physical disk size or backups. Leave server space for those separately.

Document/computation/web jobs allow two simultaneous jobs per account by default.
Set ITIS_MAX_CONCURRENT_CHAT_JOBS to an integer from 1–10 to change this server
limit. PostgreSQL serializes admissions across server replicas; ordinary chat
streams are not counted by this document-job limit. Stale jobs over 15 minutes
are cancelled on the next admission. Automatic correction is bounded to one
attempt and checks the account's remaining quota again before another paid call.
Token limits use recorded usage; in-flight usage is not reserved, so this is not
an exact provider spending cap. Redis request-rate limiting remains optional.
