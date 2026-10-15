# BGC Atlas Web App

Next.js App Router frontend and API for BGC Atlas. The app code lives in this
directory; SQL migrations live in `../new-schema/migrations`, and ingestion /
data-preparation scripts live in `../scripts` plus `scripts/`.

## Prerequisites

- Node.js LTS, version 18 or newer
- npm
- PostgreSQL database matching the SQL schema in `../new-schema/migrations`
- Redis for rate limiting, queue state, and cache-backed workflows
- Optional service dependencies for the full feature set:
  - OpenSearch for BGC property/facet search
  - SMTP for contribution, feedback and export emails
  - DIAMOND and BiG-SLiCE local conda envs or SSH Docker hosts

## Local Setup

```bash
cd bgc-atlas
npm install
cp .env.local.example .env.local
```

Fill in `.env.local` with local database, Redis, and service settings. The app
also reads `DATABASE_URL` from `.env` in a few scripts, so keep `.env` and
`.env.local` aligned when running snapshot or ingestion utilities.

Generate Prisma client code after dependency installation and whenever
`prisma/schema.prisma` changes:

```bash
npx prisma generate
```

Start the development server:

```bash
npm run dev
```

The default development URL is `http://localhost:3000`. The app serves from
the site root: `next.config.ts` reads `basePath` and `assetPrefix` from
`NEXT_PUBLIC_BASE_PATH`, which is empty unless you set it to mount the app
under a sub-path.

## Verification

Run these before opening a PR or deploying:

```bash
npm run lint
npm run test
npx tsc --noEmit
npm run build
```

`npm run lint` runs the ESLint CLI (`eslint .`) rather than the deprecated
`next lint`. It covers `scripts/` as well as `src/`, which `next lint` did not —
those scripts run under `tsx`, which neither typechecks nor lints, so a mistake
there would otherwise surface only during the run it was supposed to be doing.
`tsconfig.json` includes `scripts/` for the same reason.

The flat ESLint config ignores build output (`.next/`, `out/`, `build/`) and the
Next-generated `next-env.d.ts`. Without that a bare `eslint .` reports ~76k
problems against generated code. The project is currently 0 errors / ~49
warnings.

## Production Build And Run

Build the app:

```bash
npm run build
```

Serve the production build:

```bash
npm start
```

Do not run production with `npm run dev` or `NODE_ENV=development`. Background
jobs that use BullMQ should be run deliberately as part of the deployment model;
today some workers are initialized from the app process, so multi-process
deployments need extra care until workers are split out into a separate service.

If serving the app under a sub-path, keep these values consistent:

- `basePath` and `assetPrefix` in `next.config.ts`
- `NEXT_PUBLIC_BASE_PATH` in the runtime environment
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_API_URL`, including the base path when generated links should
  point at the mounted app, for example `https://example.org/atlas`
- reverse-proxy route prefixes

## Environment Variables

Use `.env.local.example` as the checked-in template. Important groups:

- Database: `DATABASE_URL`
- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- Public URLs: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_BASE_PATH`
- Search: `OPENSEARCH_URL`, `OPENSEARCH_INDEX`, `OPENSEARCH_VOCAB_INDEX`
- Uploads and exports: `USER_UPLOADS_DIR`, `SESSION_DIR`,
  `BIGSLICE_SESSION_DIR`, `GCF_EXPORT_DIR`
- Email: `FROM_EMAIL`, `SMTP_*`, `CONTRIBUTION_CC`, `FEEDBACK_TO`
- External tools: `SEQSEARCH_*`, `DIAMOND_*`, `BIGSLICE_*`,
  `ANTISMASH_*`

Never commit real `.env` or `.env.local` files.

## Database And Migrations

The canonical SQL migrations are in `../new-schema/migrations`. Apply them in
filename order to initialize or update a database. The Prisma schema is useful
for generated client access, but it does not currently model every SQL table,
column, materialized view, or raw-query surface used by the app.

After schema changes:

```bash
npx prisma generate
```

After data ingestion or materialized-view changes, refresh any affected static
snapshots before deployment.

## Static Snapshots

Several read-heavy charts and maps are served from content-hashed JSON files in
`public/data`. Refresh them after ingestion or whenever user-facing aggregate
counts change:

```bash
npx tsx scripts/generate-map-snapshot.ts
npx tsx scripts/generate-bgc-charts-snapshot.ts
npx tsx scripts/generate-gcf-charts-snapshot.ts
npx tsx scripts/generate-sample-charts-snapshot.ts
```

Commit the updated `public/data/*.json` files with the deployment. More detail
is documented in the repository root `README.md`.

## Python Ingestion And Crawlers

The main Python ETL and crawler tooling lives outside this app directory:

- `../scripts/populator`
- `../scripts/mgnify_v2_crawl`

Run those test suites from the repository root with the appropriate Python
environment installed. Keep their dependency files current when adding imports.

## Useful Paths

- `src/app` - App Router pages, layouts, and API routes
- `src/components` - reusable UI and visualization components
- `src/lib` - shared data access, queues, providers, hooks, utilities, and types
- `src/styles` - focused global styles such as map CSS
- `public` - static assets and generated JSON snapshots
- `prisma/schema.prisma` - Prisma client schema
