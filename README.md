# Clans Report

A Destiny 2 clan finder — browse and filter a board of published clans; founders
publish their clan by enriching Bungie-sourced data with tags, language, region,
and a Discord link. Full-stack Next.js (App Router) + Postgres (Drizzle) + Bungie API.

Design & specs live in [`specs/`](./specs) (start with `clans-report.md`); work is
tracked in [`specs/backlog.md`](./specs/backlog.md).

## Prerequisites

- Node 22+
- Docker (for local Postgres and integration tests)
- A Bungie API key — [bungie.net/en/Application](https://www.bungie.net/en/Application) (see `specs/auth.md`)

## Local setup

```bash
npm install
cp .env.example .env        # then fill BUNGIE_API_KEY (auth vars come later, in CR-12)
npm run db:reset            # starts Postgres, applies migrations, seeds sample data
npm run dev                 # http://localhost:3000
```

`db:reset` runs `docker compose up -d --wait && drizzle-kit migrate && tsx scripts/seed.ts`.

## Data

Local dev only — production fills with real clans via the owner flow, and is never seeded.

```bash
npm run db:seed             # (re)seed ~12 varied clans — idempotent, safe to re-run
npm run db:seed -- --clear  # wipe all listing + snapshot rows
```

The seed refuses to run against a non-local database (guards against touching Neon);
override with `-- --force` only if you really mean it.

Managing the database directly:

```bash
docker compose up -d        # start Postgres (named volume clans-pg-data, data persists)
docker compose down         # stop (data kept)
docker compose down -v      # stop and delete data → next `db:reset` starts fresh
npm run db:migrate          # apply pending migrations
npm run db:generate         # regenerate migration SQL after editing lib/db/schema.ts
```

## Tests

```bash
npm test                    # unit + integration (integration needs Docker)
npx vitest run --project unit   # unit only, no Docker
```

Integration tests spin up their own throwaway Postgres container (Testcontainers) —
they don't touch your dev database.

## Manual API requests

`.http` files in [`requests/`](./requests) run against local or prod via the VS Code
REST Client extension. See [`requests/README.md`](./requests/README.md).

## Deploy

Push to `main` → Vercel auto-deploys to production. Env vars (incl. `DATABASE_URL`
for Neon) are set in the Vercel dashboard.
