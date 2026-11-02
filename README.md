# iTis

AI workspace built with Next.js, PostgreSQL/pgvector and optional Redis. Includes
account-scoped chat, document analysis/export, personal memory and a separate
Image Studio. Admin controls providers, account permissions and quotas.

Use Node.js 22.13 or later. Copy `.env.example` to `.env.local`, configure the
database, Redis and provider credentials, then run:

```sh
npm ci
node scripts/migrate.mjs
npm run db:seed:local
npm run dev
```

The dev server uses port 5173. Production uses `npm run build:local` and
`npm run start:local`; the default `build`/`start` compatibility scripts target
the original hosting runtime, not this standalone deployment.

See [data operations](DATA-MANAGEMENT.md), [default plans](DEPLOYMENT-DEFAULTS.md)
and [server deployment](deployment/README.md). Runtime files and `.env` files
must remain separate from source code and public build artifacts.
