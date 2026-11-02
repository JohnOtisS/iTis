# iTis data ownership and operations

## Responsibilities

| Layer | Responsibility | Source of truth |
|---|---|---|
| `app/api/*` | Authenticate the caller, validate input, expose owner-scoped results | No independent copy of account state |
| `lib/memory-consolidation.ts` | Select relevant memories, produce/validate a compact plan, transact changes | PostgreSQL |
| `lib/memory.ts` | Encrypt/decrypt memory and retrieve a bounded relevant context | PostgreSQL; local vectors are optional |
| `lib/rate-limit.ts` | Admission counters with expiry | Redis counters with PostgreSQL fallback |
| `db/schema.ts`, `drizzle-pg/*` | Relational schema, ownership, cascades, migrations | PostgreSQL |
| `storage/*` and `stored_files` | File bytes on persistent storage, ownership and sizes in the database | Both must be backed up together |

PostgreSQL owns accounts, sessions, permissions, role plans, usage/cost estimates,
conversations, memory and file metadata. Redis does not own personal memory,
authentication or quota balances. Losing Redis does not erase these records.
Memory values and the five retained revisions use authenticated encryption.

Chat requests allow 30/minute per account; manual memory extraction allows
10/minute. Redis INCR and TTL are atomic. If Redis is unavailable, shared
PostgreSQL counters enforce limits across processes. Expired fallback rows are
pruned opportunistically on a fresh window. Switching between Redis and fallback
can allow an additional window's allowance; this is not a strict billing cap.

## Memory behavior

- Explicit requests and a narrow set of personal statements can trigger extraction.
  Ordinary document/task requests do not automatically become personal memories.
- At most 12 relevant prior memories and five short recent messages are compared;
  the entire history is not sent for every update. A plan has at most six items.
- Exact duplicates can be rejected locally. Semantic duplicates are compared by
  Luna in OpenAI mode; Local mode uses the configured local model.
- Explicit corrections can update an existing item. Unclear replacements ask for
  confirmation; no part of a conflicting plan is committed.
- The owner can edit, delete and undo the last change, with up to five revisions.
  Chat provenance is retained when available; undo still works after source-chat
  deletion. Chat deletion does not implicitly erase personal memory.
- Account locks, snapshot checks and a memory version reject stale writes,
  including extraction that was in flight when the owner cleared memory.
- Admin controls memory/automatic-learning switches. Disabling automatic learning
  still permits an explicit request; disabling personal memory blocks all writes.
  Users retain the ability to forget their own existing memory.
- A memory-only command returns the actual persistence result without a second
  answer-model call. Extraction tokens/cost estimates are recorded in usage.
- OpenAI mode does not wait for inactive LM Studio embeddings. Answers receive
  at most four selected memories, with a bounded formatted context.

The item limit is 200 active memories. Long requests must be split rather than
silently truncated. This is retrieval/personalization, not model fine-tuning.
Semantic extraction can still misinterpret wording; owner editing and undo remain
necessary. Credentials are not stored in personal memory.

## Persistent deployment files

Docker Compose mounts separate volumes for generated documents, images, avatars
and branding. Existing local files must be copied to the corresponding volumes
when moving from host development to Docker. An empty new volume is not an
automatic migration of host files.

Keep `MEMORY_ENCRYPTION_KEY` stable and backed up securely. If it is omitted, the
existing `SESSION_SECRET` fallback is used; changing that secret can make old
memory unreadable. Docker now forwards the explicit memory key as well.

`ITIS_DOCKER_DATABASE_URL` can override the app's container-network database URL;
it must match PostgreSQL's actual database/user/password. Redis uses the same
`ITIS_REDIS_PASSWORD` in the app and Redis service. Current fallback credentials
are for local development; configure host deployment credentials explicitly.

Runtime files, backups and generated test artifacts are excluded from Docker
build context. `storage/` and backups are also excluded from new Git tracking.
Three existing runtime files were removed from the Git index, preserving disk
copies. This does not rewrite their earlier Git history.

## Checks

Run `pnpm run data:health` for read-only counts, connectivity, migration count,
Redis persistence, file-size consistency and missing physical files. It prints
no account identities, message bodies, memory text or credentials.

Relevant regression commands:

```
pnpm exec tsx --env-file=.env.local scripts/test-memory-data.ts
node --env-file=.env.local scripts/test-memory-settings.mjs
node --env-file=.env.local scripts/test-storage.mjs --http
node --env-file=.env.local scripts/test-memory-consolidation.mjs
```

The last command invokes the configured model on synthetic data and records a
local test report. Temporary accounts and server-side test data are cleaned up.

## Current findings — 2 November 2026

- PostgreSQL and Redis are reachable; Redis AOF is enabled; 15 migrations applied.
- No expired sessions, stale chat jobs or cross-account memory source references
  were found at the inspection time.
- Nine registered file records were inspected; existing physical files match
  their registered sizes.
- Four old references have no physical content: two chat files and two images.
  All four were already registered with zero bytes. No missing document content
  was reconstructed or deleted during this review. Restore from a matching
  backup or re-upload if those historical files are still needed.
- No runtime files remain in the current Git index after separation.

## Remaining operational work

Back up PostgreSQL, all four file volumes and the encryption key as one recovery
set. A backup is only verified after a restore test into an isolated environment.
This change did not configure a backup provider/schedule or certify a restore.
Redis is recoverable temporary state; a Redis backup is not a database backup.

Document jobs remain in-process workers with persisted status, not a durable
external queue. A global worker queue and strict in-flight token/currency
reservations are still useful before scaling to many replicas or users. Logical
history/file quotas do not measure PostgreSQL indexes, WAL, revisions, operational
metadata or backups; leave physical disk headroom and monitor the database size.

Structured extraction follows [official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
with server-side validation before any memory transaction.
