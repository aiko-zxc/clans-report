# Clans Report — Backlog

Thin, review-sized tickets: **one ticket = one local commit (or branch) that gets reviewed before the next ticket starts.** Every ticket still ends with something runnable locally.

**Local-first constraint:** development happens fully locally (dev Bungie app on `127.0.0.1`, local Postgres, manual cron runs); GitHub / Vercel / CI / scheduled crons all land in the final ticket **CR-23 (Ship)**. Git is local from day one; only the **push** waits for CR-23.

**Git identity:** the machine's global git config is the work account — commits here must use the personal identity via a conditional include (`[includeIf "gitdir:~/Projects/pet/"]` → `~/.gitconfig-personal`, GitHub noreply email). Verify `git log` authorship before the first push.

**Push auth — no personal GitHub login on the work machine:** a repo-scoped **deploy key** with write access (`~/.ssh/clans_report_deploy` + `Host github-clans` alias; remote `git@github-clans:<user>/clans-report.git`). The laptop can only push/pull this one repo; everything account-level (create repo, add the deploy key, merge PRs, Actions logs, secrets) happens in a browser on personal devices.

**Status is tracked in the ticket heading:** `[TO DO]` → `[IN PROGRESS]` → `[DONE]` (plus `[BLOCKED — <reason>]` when stuck).

**Responsive:** the site is responsive web (nothing fancy — see clans-report.md #11). Every UI ticket's DoD includes "renders correctly at mobile width".

**Migrate to GitHub Issues once the repo exists** (this file then becomes a pointer, not a tracker).

UI source of truth: **Figma** (link: _TBD_).

Dependencies: phases are sequential; tickets inside a phase are sequential unless noted. Visitor UI (C) can run any time after B; D–E need B; F needs E-BE.

---

## Phase A — Foundation

### [TO DO] CR-1 — Project scaffold

- [ ] Git identity: `~/.gitconfig-personal` + conditional include for `~/Projects/pet/`; `git init`; verify authorship with a test commit (`git log --format='%an %ae'`)
- [ ] `create-next-app` (TypeScript, App Router), strict TS, placeholder home page

**DoD:** `next dev` serves the placeholder; commit authored by the personal identity.

### [TO DO] CR-2 — DB schema + migrations

- [ ] `lib/db/schema.ts` per [db.md](./db.md) (all 6 tables, indexes, constraints)
- [ ] Migrations `0000_init`, `0001_bungie_snapshots` — generated SQL reviewed against db.md
- [ ] `lib/db/client.ts` (drizzle + `pg` Pool); local `postgres:16` via Docker

**DoD:** `drizzle-kit migrate` applies cleanly to a fresh local DB; generated SQL matches db.md.

### [TO DO] CR-3 — Core lib

- [ ] `lib/errors.ts`: `ErrorCode` map per api.md, `AppError`, `problem()`, `handled()` wrapper
- [ ] `lib/taxonomy.ts`: playstyle tags, languages, regions, platforms, membership types, staleness threshold
- [ ] `lib/validation.ts`: zod schemas per [api.md](./api.md) (search / publish / edit) incl. min≤max refine
- [ ] Unit tests: zod edge cases, Discord URL regex, error mapping

**DoD:** `npm test` green; pure code — reviewable without running anything.

### [TO DO] CR-4 — Test harness

- [ ] Vitest `globalSetup`: one `postgres:16` Testcontainer per run, migrations applied once
- [ ] Truncate-between-tests helper; MSW node server stub + first Bungie response factory
- [ ] One smoke integration test (insert via repo → read back)
- [ ] `ci.yml` written (test + migrate jobs) — verified later in CR-23

**DoD:** integration smoke test green locally.

### [TO DO] CR-5 — Manual requests kit

- [ ] `.vscode/settings.json`: REST Client environments (`local` / `local-https` / `prod`)
- [ ] `.env.example` (`DATABASE_URL`, `BUNGIE_API_KEY`, `SESSION_COOKIE`, …); `requests/README.md`
- [ ] `requests/bungie.http`: GetGroup, GetMembersOfGroup, GetGroupsForMember (file-level `@groupId`)

**DoD:** with a real API key in `.env`, all three Bungie requests return live JSON from VS Code.

## Phase B — Read path (API)

### [TO DO] CR-6 — Search endpoint

- [ ] `POST /api/clans/search`: repo query (AND across / OR within, ILIKE with `%_` escaping, size-tags via member_count, pagination, sort `updated_at DESC`) + service + route
- [ ] `requests/clans.http`: per-filter examples
- [ ] Integration tests: each filter, combinations, size-tag boundaries (19/20/50/51), pagination, 400s; unit: ILIKE escaping

**DoD:** endpoint matches api.md verbatim, verified via clans.http against seeded rows (manual insert ok until CR-8).

### [TO DO] CR-7 — Detail endpoint

- [ ] `GET /api/clans/{bungieGroupId}`: full `ClanDetail` (members, founder resolution, `dataFetchedAt`), `404 LISTING_NOT_FOUND`
- [ ] clans.http entries (detail + 404); integration tests

### [TO DO] CR-8 — Seed script

- [ ] `scripts/seed.ts`: ~a dozen varied fake listings (tags/languages/regions/sizes spread for filter demos)

**DoD:** fresh DB → seed → board API returns a believable directory.

## Phase C — Visitor UI (any time after B)

### [TO DO] CR-9 — Board page

- [ ] Card grid per Figma (banner, name, 3 tags + `+N`, member count badge), numbered pagination, empty + error states
- [ ] First paint via server component (direct service call)
- [ ] Renders correctly at mobile width

### [TO DO] CR-10 — Board filters

- [ ] Filter sidebar per Figma (chips, min/max, Confirm-applies), POSTs `/api/clans/search`
- [ ] Filter state mirrored to URL query params (shareable, re-POST on load)
- [ ] Usable at mobile width (per Figma if a mobile frame exists, else sensible collapse)

**DoD (C-phase):** a visitor finds a clan with filters locally, desktop and phone-width; matches Figma.

### [TO DO] CR-11 — Clan detail page

- [ ] Two-column layout per Figma (details panel, banner/motto/description, member grid); columns stack at mobile width
- [ ] Stale badge (`dataFetchedAt` > 12h), Discord button (hidden when null), Bungie Page link, 404 page

## Phase D — Auth

### [TO DO] CR-12 — Bungie login round-trip

- [ ] Auth.js + Bungie provider (`lib/auth.ts` + catch-all route); verify `X-API-Key` reaches token/userinfo requests
- [ ] `jwt` callback: initial sign-in (founder lookup, `app_user` upsert, claims) + `update` branch; `session` callback
- [ ] Dev Bungie app registered (redirect `https://127.0.0.1:3000/api/auth/callback/bungie`); `next dev --experimental-https` verified
- [ ] Unit tests for the callbacks against MSW (founder / non-founder / Bungie-down)

**DoD:** real Bungie login → session cookie with correct claims, locally.

### [TO DO] CR-13 — `/api/me` + guards

- [ ] `lib/guards.ts` (`requireSession` / `requireFounder`); `GET /api/me` (pure DB read)
- [ ] `requests/me.http` (+ cookie how-to in README); integration tests: 401 / 200 founder / 200 with listing

### [TO DO] CR-14 — Header + CTA

- [ ] Header per Figma: Log in / user menu / CTA logic from [auth.md](./auth.md) (`/api/me`-driven, client-cached per flow.md)
- [ ] Renders correctly at mobile width

## Phase E — Owner flows

### [TO DO] CR-15 — Preview endpoint

- [ ] `GET /api/clans/preview` (session-derived group id; 401/403/503) + tests + me.http entry

### [TO DO] CR-16 — Publish endpoint

- [ ] `POST /api/me/listing`: live founder re-check, snapshot + members fetch, 5-table transaction, `409 LISTING_ALREADY_EXISTS`
- [ ] Integration tests incl. transaction atomicity + every error code; me.http entry

### [TO DO] CR-17 — Edit endpoint

- [ ] `PUT /api/me/listing`: optimistic lock (`409 VERSION_CONFLICT`), founder re-check → `410 STALE_LISTING_REMOVED` self-heal (hard-delete in transaction)
- [ ] Integration tests: lock conflict, self-heal, every error code; me.http entries (happy + version-conflict)

### [TO DO] CR-18 — Delist endpoint

- [ ] `DELETE /api/me/listing`: transaction (snapshots + listing + cascades), `404 NO_LISTING`
- [ ] Integration tests; me.http entry

### [TO DO] CR-19 — Publish form UI

- [ ] `/publish` per Figma: read-only Bungie preview + editorial fields (Discord URL, language, region, tags, platforms), field-level 400 errors
- [ ] Renders correctly at mobile width

### [TO DO] CR-20 — Manage page UI

- [ ] `/manage` per Figma: prefill from cached `/api/me.listing`, save with version echo, success toast
- [ ] Delist confirmation modal (hard-delete warning)
- [ ] 410 handling: banner + Auth.js `update()` claim refresh + header repaint (flow O5)
- [ ] Renders correctly at mobile width

**DoD (E-phase):** full O1–O5 cycle by hand locally with a real clan (real Bungie, local DB), desktop and phone-width.

## Phase F — Crons

### [TO DO] CR-21 — Basic refresh (S1 + S3)

- [ ] `lib/services/sync-service.ts`: basic refresh (founder compare → auto-delist transaction), 429 policy (sleep `ThrottleSeconds`, retry once, exit 0 on repeat), per-listing error isolation, summary log line
- [ ] `scripts/refresh-basic.ts` (`p-limit`, `BUNGIE_CONCURRENCY`) + `refresh-basic.yml` (6h, `workflow_dispatch`, `concurrency: bungie-refresh`) — yml verified in CR-23
- [ ] Tests: 200 match / founder mismatch → auto-delist / 404 → auto-delist / 429 / 5xx skip

**DoD:** `npx tsx scripts/refresh-basic.ts` runs clean against local DB + real Bungie.

### [TO DO] CR-22 — Members refresh (S2)

- [ ] Members refresh in sync-service: upsert + delete-stale in one transaction; 404 → auto-delist
- [ ] `scripts/refresh-members.ts` + `refresh-members.yml` (24h, offset)
- [ ] Tests: upsert/delete-stale, display-name change, 404

## Phase G — Ship

### [TO DO] CR-23 — Ship & launch (first contact with GitHub/Vercel/Neon)

- [ ] GitHub repo (public, via web UI **from a personal device**) + deploy key with write access added there
- [ ] Laptop: `ssh-keygen` deploy key, `~/.ssh/config` alias, `git remote add` → push; re-verify authorship (`git log --format='%an %ae' | sort -u`)
- [ ] Neon: create project, apply migrations, seed demo data
- [ ] Vercel import + env vars; first prod deploy
- [ ] Verify `ci.yml` green on a test PR; branch protection on `main`
- [ ] Enable + verify cron workflows (repo secrets, `workflow_dispatch` smoke run)
- [ ] Prod Bungie app pointed at the Vercel domain
- [ ] Prod smoke: board, detail, login, O1–O5; then remove seed data
- [ ] Error pages (global error boundary, BE-down state); README (setup, env vars, requests how-to)
- [ ] Optional: custom domain (CNAME), Vercel Analytics
