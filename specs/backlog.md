# Clans Report — Backlog

Thin, review-sized tickets: **one ticket = one local commit (or branch) that gets reviewed before the next ticket starts.** Every ticket still ends with something runnable locally.

**Push-often workflow (set up in CR-1):** repo, deploy key, and Vercel are already live — every push to `main` auto-deploys to https://clans-report.vercel.app. So we commit+push per ticket and watch prod, rather than deferring git to the end. What still waits for CR-23: Neon (prod DB), CI wiring, branch protection, cron workflow enablement, prod Bungie app.

**Git identity:** commits use the personal identity (GitHub noreply email) via a per-directory conditional include. ✅ done in CR-1.

**Push auth:** repo-scoped **deploy key** with write access (SSH host alias, remote `git@github-clans:aiko-zxc/clans-report.git`). ✅ done in CR-1.

**Caveat — prod needs env vars from CR-2 on:** once a page/endpoint touches the DB, prod will error until `DATABASE_URL` (Neon) is set in Vercel. CR-2 includes provisioning Neon early so prod keeps working through the push-often loop.

**Status is tracked in the ticket heading:** `[TO DO]` → `[IN PROGRESS]` → `[DONE]` (plus `[BLOCKED — <reason>]` when stuck).

**Responsive:** the site is responsive web (nothing fancy — see clans-report.md #11). Every UI ticket's DoD includes "renders correctly at mobile width".

**Migrate to GitHub Issues once the repo exists** (this file then becomes a pointer, not a tracker).

UI source of truth: **Figma** (link: _TBD_).

Dependencies: phases are sequential; tickets inside a phase are sequential unless noted. Visitor UI (C) can run any time after B; D–E need B; F needs E-BE.

---

## Phase A — Foundation

### [DONE] CR-1 — Project scaffold

- [x] Git identity: personal identity via per-directory conditional include; verify authorship (`git log --format='%an %ae'`)
- [x] `create-next-app` (TypeScript, App Router), strict TS, placeholder home page

**DoD:** `next dev` serves the placeholder; commit authored by the personal identity.

### [DONE] CR-2 — DB schema + migrations

- [x] `lib/db/schema.ts` per [db.md](./db.md) (all 6 tables, indexes, constraints)
- [x] Migrations `0000_init`, `0001_bungie_snapshots` — generated SQL reviewed against db.md
- [x] `lib/db/client.ts` (drizzle + `pg` Pool); local `postgres:17` via Docker
- [x] Provision Neon + set `DATABASE_URL` in Vercel + apply migrations to it — keeps prod alive as DB-touching code lands (pulled forward from CR-23 for the push-often loop)

**DoD:** `drizzle-kit migrate` applies cleanly to a fresh local DB **and** to Neon; generated SQL matches db.md.

### [DONE] CR-3 — Core lib

- [x] `lib/errors.ts`: `ErrorCode` map per api.md, `AppError`, `problem()`, `handled()` wrapper
- [x] `lib/taxonomy.ts`: playstyle tags, languages, regions, platforms, membership types, staleness threshold
- [x] `lib/validation.ts`: zod schemas per [api.md](./api.md) (search / publish / edit) incl. min≤max refine
- [x] Unit tests: zod edge cases, Discord URL regex, error mapping

**DoD:** `npm test` green; pure code — reviewable without running anything.

### [DONE] CR-4 — Test harness

- [x] Vitest `globalSetup`: one `postgres:17` Testcontainer per run, migrations applied once
- [x] Truncate-between-tests helper; MSW node server stub + first Bungie response factory
- [x] One smoke integration test (insert via repo → read back)
- [x] `ci.yml` written (test + migrate jobs) — verified later in CR-23

**DoD:** integration smoke test green locally.

### [DONE] CR-5 — Manual requests kit

- [x] `.vscode/settings.json`: REST Client environments (`local` / `local-https` / `prod`)
- [x] `.env.example` (`DATABASE_URL`, `BUNGIE_API_KEY`, `SESSION_COOKIE`, …); `requests/README.md`
- [x] `requests/bungie.http`: GetGroup, GetMembersOfGroup, GetGroupsForMember (file-level `@groupId`)

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

### [IN PROGRESS] CR-20 — Manage page UI

- [ ] `/manage` per Figma: prefill from cached `/api/me.listing`, save with version echo, success toast
- [ ] Delist confirmation modal (hard-delete warning)
- [ ] 410 handling: banner + Auth.js `update()` claim refresh + header repaint (flow O5)
- [ ] Renders correctly at mobile width

**DoD (E-phase):** full O1–O5 cycle by hand locally with a real clan (real Bungie, local DB), desktop and phone-width.

## Phase F — Crons

### [IN PROGRESS] CR-21 — Basic refresh (S1 + S3)

- [ ] `lib/services/sync-service.ts`: basic refresh (founder compare → auto-delist transaction), 429 policy (sleep `ThrottleSeconds`, retry once, exit 0 on repeat), per-listing error isolation, summary log line
- [ ] `scripts/refresh-basic.ts` (`p-limit`, `BUNGIE_CONCURRENCY`) + `refresh-basic.yml` (6h, `workflow_dispatch`, `concurrency: bungie-refresh`) — yml verified in CR-23
- [ ] Tests: 200 match / founder mismatch → auto-delist / 404 → auto-delist / 429 / 5xx skip

**DoD:** `npx tsx scripts/refresh-basic.ts` runs clean against local DB + real Bungie.

### [IN PROGRESS] CR-22 — Members refresh (S2)

- [ ] Members refresh in sync-service: upsert + delete-stale in one transaction; 404 → auto-delist
- [ ] `scripts/refresh-members.ts` + `refresh-members.yml` (24h, offset)
- [ ] Tests: upsert/delete-stale, display-name change, 404

## Phase G — Ship

### [IN PROGRESS] CR-23 — Launch hardening

Repo, deploy key, Vercel auto-deploy, and prod URL were all set up in CR-1; Neon lands in CR-2. This ticket is what's left to call it launched.

- [ ] Verify `ci.yml` green on a test PR; branch protection on `main`
- [ ] Enable + verify cron workflows (repo secrets, `workflow_dispatch` smoke run)
- [ ] Prod Bungie app pointed at the prod domain
- [ ] Prod smoke: board, detail, login, O1–O5; then remove seed data
- [ ] Error pages (global error boundary, BE-down state); README (setup, env vars, requests how-to)
- [ ] Optional: custom domain (CNAME), Vercel Analytics
