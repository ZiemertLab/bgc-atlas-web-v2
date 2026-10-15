# Contributing

## Web app (`bgc-atlas/`)

Node.js 20 or newer.

```bash
cd bgc-atlas
npm ci
cp .env.local.example .env.local     # then fill in your own services
npx prisma generate                  # after install and after any schema change
npm run dev                          # http://localhost:3000
```

Before sending a change:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

TypeScript is strict; indent with two spaces and end statements with semicolons.
Name files in kebab-case and React components in PascalCase; hooks start with
`use` and live in `src/lib/hooks/`. Prefer Tailwind utility classes, and reuse
the shared table, map, chart and panel components rather than writing new ones.

## Python (`scripts/`)

Python 3.10 or newer. From the repository root:

```bash
python -m venv .venv
.venv/bin/pip install -r scripts/populator/requirements.txt
.venv/bin/python -m pytest
```

`pytest.ini` lists the suites. Tests that read the uncommitted third-party data
files (`THIRD_PARTY.md`) or the full data root skip until those are restored.

## Schema changes

Add a numbered SQL file to `new-schema/migrations/`, after the highest existing
number, and apply files in order. See `new-schema/README.md`.

## Commits

Short imperative subject lines (`Add map legend`); `feat:` / `fix:` prefixes are
welcome. Never commit secrets, `.env` files or data from `THIRD_PARTY.md`.
