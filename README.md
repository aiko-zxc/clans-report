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
npm run db:setup            # start Postgres + migrate + seed (see below)
npm run dev                 # http://localhost:3000
```

`db:setup` just chains the three DB steps below — run it once to get going.

## Database

Each command does exactly one thing:

```bash
npm run db:up         # start local Postgres (docker compose, named volume — data persists)
npm run db:migrate    # apply pending migrations
npm run db:seed       # load ~12 sample clans (truncates first, so it's a clean re-seed)
npm run db:generate   # regenerate migration SQL after editing lib/db/schema.ts
npm run db:studio     # browse the DB in Drizzle Studio
npm run db:setup      # db:up + db:migrate + db:seed (first-time bootstrap)
```

Common tasks:

- **Refresh sample data:** `npm run db:seed` (idempotent — wipes and reloads the 12 clans).
- **Wipe listings without reloading:** `npm run db:seed -- --clear`.
- **Start completely fresh (drop the volume):** `docker compose down -v && npm run db:setup`.

Seeding is local-dev only: the script refuses to run against a non-local database
(guards against touching Neon) unless you pass `-- --force`. Production fills with
real clans via the owner flow and is never seeded.

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
