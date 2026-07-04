# Clans Report — v1 Spec

## Problem

There is no convenient way to find a Destiny 2 clan that matches a player's preferences. Current options:
- **Discord servers** with separate application channels — no filters, no structured data, recruitment lost in chat history.
- **Bungie.net forum** — no tags, no filters, hard to scan.

A player who wants e.g. *"Russian-speaking, PvE-focused, PC, ~50 members, open membership"* has no way to query for that.

## Solution

A web service where:
- **Visitors (anonymous)** browse a board of published clan cards, filter/search by structured attributes.
- **Clan owners (authenticated via Bungie OAuth)** publish their clan listing by enriching Bungie-sourced data with tags, Discord link, language, and timezone. Owners can edit or delist at any time.

Most clan attributes are pulled live from the Bungie API; only a thin layer of editorial metadata is user-supplied.

## Out of scope (v1)

Explicitly deferred — do not design v1 around these:
- Reviews / ratings
- In-app applications to join a clan (we link to Discord/Bungie instead)
- Recruitment posts, messaging, comments
- Favorites / bookmarks
- User accounts for non-owners (no profiles for regular visitors)
- Multi-language UI (English-only UI; clan content may be in any language)

## User roles

| Role | Auth | Can do |
|------|------|--------|
| Visitor | None | Browse board, filter, search, view clan detail page |
| Clan Owner | Bungie OAuth, must be **Founder** of the clan in Destiny | Everything a visitor can + publish, edit, delist their clan |

> Note: only the Destiny clan **Founder** can publish (decision: question #4 → (a)). Admins cannot publish on the founder's behalf. If clan ownership changes in Bungie, the listing must be re-claimed by the new founder.

## Pages

### 1. Board (home)

- Header: title "Clans Report", tagline, "Add my clan" CTA top right.
- Left sidebar: filter panel (see *Filtering* below). Filters apply on explicit **"Confirm"** click, not live.
- Main area: paginated grid of clan cards.

**Clan card shows:**
- Banner image (from Bungie API)
- Clan name
- Up to 3 visible tags + `+N` overflow
- Member count badge

### 2. Clan detail page

Layout matches the mockup. Two-column.

**Left column ("Details" panel):**
- Owner (Bungie name + discriminator)
- Members (count)
- Membership type (Open / Application / Closed)
- Date of creation
- Language (owner-supplied)
- Region (owner-supplied: Americas / Europe / Asia-Pacific)
- Playstyle tags (owner-supplied)
- Platforms
- Clan level (current / max, with progress bar)

**Below details: action buttons**
- "Discord" → owner-supplied link, opens in new tab
- "Bungie Page" → deep link to the clan's Bungie.net page

**Right column:**
- Banner image + Motto + Description (all from Bungie API)
- Members section: grid of clan members with their emblem icon + Bungie name (`Name#1234`)

### 3. Owner-only views

- **Publish flow** (`Add my clan`): redirect to Bungie OAuth → on callback, list clans where user is Founder → owner picks one → form to add tags / Discord link / language / timezone → publish.
- **Edit listing**: same form, prefilled.
- **Delist**: confirmation dialog → hard-deletes listing and all owner-supplied data (tags, Discord, language, timezone). Re-publishing later requires filling the form from scratch.

## Filtering & search

All filters are AND-combined across categories; multi-select within a category is OR.

| Filter | Source | Type |
|--------|--------|------|
| Name search | Clan name (substring, case-insensitive) | text |
| Playstyle tags | Owner-supplied, fixed predefined list | multi-select chip |
| Language | Owner-supplied, fixed predefined list | multi-select chip |
| Region | Owner-supplied, fixed 3-value enum | multi-select chip |
| Platforms | Bungie API (per-member platform aggregation) | multi-select chip |
| Membership type | Bungie API | multi-select chip |
| Guardian count | Bungie API | min / max numeric |

### Fixed tag taxonomy (v1)

**Playstyle (owner picks any subset):**
`PvE`, `Hardcore PvE`, `PvPvE`, `Hardcore PvP`, `Contest`, `Crucible`, `Gambit`, `Raids`, `Low Man`

**Auto-derived size tags (NOT owner-picked, computed from member count):**
- `Small Clan`: < 20 members
- `Big Clan`: > 50 members

> Decision: question #2 → auto. Size tags are read-only and reflect current Bungie member count. They are filter targets but cannot be set manually.

**Language (owner picks one):**
`English`, `Russian`, `German`, `French`, `Español`, `Ukrainian`, `Polski` *(extend as needed; fixed list maintained server-side)*

**Region (owner picks one — fixed enum):**
`Americas`, `Europe`, `Asia-Pacific`

**Platforms (auto from Bungie API — aggregated from member platforms):**
`PC`, `PlayStation`, `XBOX`, `Epic Games`

**Membership type (from Bungie API):**
`Open`, `Application`, `Closed`

## Data sources

| Field | Source |
|-------|--------|
| Clan name, abbreviation `[MOON]`, founder, member list, member icons, member count, motto, description, creation date, banner, membership type, clan level, member platforms | Bungie API |
| Playstyle tags, language, region, Discord link | Owner-supplied |
| Auto size tags (`Small Clan` / `Big Clan`) | Derived from Bungie member count |

## Auth flow (Bungie OAuth)

- Standard OAuth 2.0 authorization code flow, via Auth.js — see [auth.md](./auth.md).
- App registered at `bungie.net/en/Application` → get `client_id` / `client_secret`.
- Scopes: `ReadBasicUserProfile`, `ReadGroups` (enough to list user's clans and verify founder role).
- Session: signed JWT cookie (Auth.js), 30 days. No session table.
- Logout: clears the cookie; Bungie session untouched.
- Access token used once at login for identity, then discarded — never stored, never sent to browser.

## Data model (initial sketch)

> Stack: full-stack Next.js (route handlers as the API) + Postgres (Neon) via Drizzle. This sketch is historical — the authoritative schema lives in [db.md](./db.md).

**`clan_listing`** — only published clans live here.
- `id` (PK, UUID)
- `bungie_group_id` (unique, indexed) — the Destiny clan ID
- `owner_bungie_id` — who published it (must be founder at publish time)
- `discord_url` (nullable)
- `language` (enum-like, FK to taxonomy)
- `region` (enum: `AMERICAS` / `EUROPE` / `ASIA_PACIFIC`)
- `tags` — owner-picked playstyle tags (separate table or array column)
- `status` — `PUBLISHED` | `DELISTED`
- `created_at`, `updated_at`

**`clan_listing_tag`** — many-to-many, owner-picked tags only.

**`bungie_clan_snapshot`** — cached Bungie API data per clan.
- `bungie_group_id` (PK)
- `name`, `motto`, `description`, `banner_url`, `member_count`, `clan_level`, `membership_type`, `founder_bungie_id`, `created_date`, `platforms` (aggregated)
- `fetched_at` — for cache TTL

**`bungie_member_snapshot`** — cached member list per clan.
- `(bungie_group_id, bungie_membership_id)` (PK)
- `display_name`, `discriminator`, `icon_path`
- `fetched_at`

**`taxonomy_tag`** / **`taxonomy_language`** — fixed lookup tables, seeded on startup.

## API surface (initial sketch — superseded by [api.md](./api.md))

```
GET  /api/clans                       # list + filter + paginate
GET  /api/clans/{bungieGroupId}       # detail (joins listing + snapshot + members)
POST /api/clans                       # publish — owner only, validates founder role
PUT  /api/clans/{bungieGroupId}       # edit — owner only
POST /api/clans/{bungieGroupId}/delist  # delist — owner only

GET  /api/auth/bungie/login           # redirect to Bungie OAuth
GET  /api/auth/bungie/callback        # OAuth callback
POST /api/auth/logout
GET  /api/me                          # current user + clans they founded

GET  /api/taxonomy/tags
GET  /api/taxonomy/languages
```

Filter query params on `GET /api/clans`:
`name`, `tags[]`, `languages[]`, `regions[]`, `platforms[]`, `membership[]`, `minMembers`, `maxMembers`, `page`, `pageSize`.

## Bungie data sync

All Bungie-sourced fields are cached in `bungie_clan_snapshot` and `bungie_member_snapshot`. Pages render from cache — Bungie API is never called on user-facing GETs.

**Refresh triggers:**

| Trigger | What refreshes | When |
|---|---|---|
| Owner publishes | Full snapshot (basic + members) for that clan | Synchronously, during publish |
| Owner edits listing | Basic snapshot for that clan | Synchronously, during edit |
| Cron — basic | All `PUBLISHED` clans: name, motto, member count, banner, clan level, membership type, founder, platforms | Every **6 hours** |
| Cron — members | All `PUBLISHED` clans: member list with icons | Every **24 hours** |
| Bungie API down | Serve last-good snapshot; cron retries on next tick | — |

**API budget sanity check:**
- 100 clans: ~16 basic + 4 member-list refreshes/hour. Trivial.
- 1000 clans: ~166 basic + 42 member-list refreshes/hour. Still well under the 25 req/sec limit.

**Implementation notes:**
- One GitHub Actions scheduled workflow per cron, each running a Node script directly against DB + Bungie (see [be.md](./be.md)).
- Concurrency bounded with `p-limit`; slow runs are fine — nobody waits on the job.
- Track `fetched_at` per row; never block a user request to refresh inline.

## Auto-delist conditions

The basic-info cron job auto-delists a listing in these cases:

| Condition | Detection |
|---|---|
| Bungie clan no longer exists | API returns 404 / group not found |
| Founder role changed (new founder, or original publisher demoted) | API returns a different `founderMembershipId` than `clan_listing.owner_bungie_id` |

**On auto-delist:**
- `clan_listing` row is **hard deleted**, including owner-supplied tags / Discord link / language / timezone.
- `bungie_clan_snapshot` and `bungie_member_snapshot` rows for this clan are also deleted.
- No notification to the original owner (no email infra in v1).
- If the new founder later wants the clan listed, they log in via Bungie OAuth and publish from scratch.

## Infrastructure (v1)

Target: near-zero monthly cost. Only fixed cost is the domain (optional).

| Layer | Choice | Cost |
|-------|--------|------|
| App (FE + API) | One full-stack **Next.js** app on **Vercel** (Hobby, serverless) | $0 |
| Database | **Neon** — serverless Postgres, scale-to-zero | $0 (free tier: 0.5 GB) |
| Crons + CI | **GitHub Actions** scheduled workflows | $0 (public repo → unlimited minutes) |
| DNS / TLS | `<project>.vercel.app` with HTTPS out of the box | $0 |
| Domain (optional) | Cloudflare Registrar, CNAME to Vercel | ~$10/yr |

**Notes:**
- Deploy = `git push`: `main` → production, any branch → preview URL. No servers, no containers, no keep-alive hacks.
- Neon suspends after ~5 min idle → first query after a quiet period pays ~0.5–1s cold start. Accepted; self-healing.
- **No static export** — `output: 'export'` would disable the API route handlers this design depends on.
- Bungie OAuth callback URL must be HTTPS — the Vercel domain satisfies this from day one.
- Local dev: no tunnel — dev Bungie app with redirect `https://127.0.0.1:3000/...` + `next dev --experimental-https`. See [be.md](./be.md).

## Open questions / TBD

Grouped by impact. The first block must be resolved before implementation — they shape the data model or core behavior. The rest can be decided during implementation.

### Blocking — resolve before implementation

1. **Bungie API refresh strategy** — *decided*. See [Bungie data sync](#bungie-data-sync) section below.

2. **Clan deleted / founder changed** — *decided*. Auto-delist (hard delete) on next cron tick. See [Auto-delist conditions](#auto-delist-conditions) below.

3. **Re-publish flow after delist** — *decided*. Hard delete on any delist (owner-initiated or auto). Re-publishing = full form from scratch. No "restore previous listing" path.

4. **Region field — how is it used?** — *decided*. Owner picks one of 3 buckets (`Americas` / `Europe` / `Asia-Pacific`) at publish time. Shown on clan detail page and used as a multi-select filter on the board. (Originally spec'd as "timezone" — renamed to "region" since we don't need IANA precision.)

5. **Multiple languages per clan** — *decided*. Single language per clan (owner picks one). Bilingual clans pick whichever they want to lead with. Keeps schema and filter logic simple.

### Non-blocking — pick during implementation

6. **Size tag thresholds** — *decided*. `Small Clan` < 20 members, `Big Clan` > 50 members.

7. **Pagination defaults** — *decided*. **8 cards/page**, numbered pagination (not infinite scroll — easier to share filter URLs).

8. **Sort order on the board** — *decided*. Default sort: **recently published or updated** (newest activity first). User-toggleable sort can be added later.

9. **Rate-limit / failure handling for Bungie API** — *decided*. When Bungie is down (weekly reset, patches), serve last-good snapshot with a small "data may be outdated" indicator on the detail page.

10. **Abuse / spam prevention**
    Founder-only publishing is the main moat. A malicious founder could still spam tags / fake Discord links. Acceptable risk for v1; revisit if abuse appears.

11. **Mobile** — *decided*. Responsive web: every page must look right on mobile widths (checked as part of each UI ticket's DoD), following Figma where mobile frames exist. Nothing beyond responsive CSS — no separate mobile pass, no native apps.

12. **Analytics**
    None planned. Vercel's built-in analytics (free tier) gives basic traffic visibility; can enable later.

## Non-goals (clarifications)

- No native chat or messaging — Discord is the integration point.
- No leaderboards, no analytics dashboards for owners.
- No mobile apps; responsive web is the target (see open question #11).
