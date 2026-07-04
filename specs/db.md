# Clans Report — Database Schema

Postgres 17 (Neon; local + Testcontainers pinned to the same major). Drizzle ORM for access. drizzle-kit for migrations. UUID PKs across the board, `text` over `varchar`, `int` over `smallint`. All app tables include `created_at`, `updated_at`, `version` for optimistic locking on mutable rows.

## Conventions

- **PKs**: UUID, generated app-side.
- **Bungie IDs**: stored as `text` (19-digit numeric strings — fit in `bigint` but stored as text to match Bungie's API contract).
- **Membership types**: `int` (1=Xbox, 2=PSN, 3=Steam, 5=Stadia, 6=Epic, 254=Bungie.net).
- **Timestamps**: `timestamptz`, UTC.
- **Enums**: stored as `text`, validated at app layer (avoids Postgres enum migration pain).

## Migrations (drizzle-kit)

- Source of truth: `lib/db/schema.ts` — tables are defined in TypeScript; `npx drizzle-kit generate` diffs the schema and emits SQL into `drizzle/`.
- Naming: drizzle-kit's `NNNN_<description>.sql` — pass `--name` so descriptions are meaningful, not auto-generated words.
- One migration = one logical change. Once merged to main, never edit a generated SQL file — change `schema.ts` and generate a new migration.
- **Review the generated SQL** before committing — the emitted DDL must match the definitions in this document (this file stays the design source; `schema.ts` implements it).
- Applied via `npx drizzle-kit migrate`: locally by hand, on prod by the CI `migrate` job on push to `main` (see [be.md](./be.md) — includes the additive/backward-compatible constraint).
- Initial set:
  - `0000_init` — `app_user`, `clan_listing`, `clan_listing_playstyle_tag`, `clan_listing_platform` + indexes.
  - `0001_bungie_snapshots` — `bungie_clan_snapshot`, `bungie_member_snapshot` + indexes.

(No session-table migration — sessions are a JWT cookie, see [auth.md](./auth.md).)

## Tables

### `app_user`

The OAuth'd identity. One row per Bungie.net account.

```sql
CREATE TABLE app_user (
  id                 UUID PRIMARY KEY,
  bungie_net_id      TEXT NOT NULL,            -- membershipType=254, lifetime-stable
  display_name       TEXT,
  display_name_code  INT,                       -- the #1234 discriminator
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL,
  last_login_at      TIMESTAMPTZ,
  version            INT NOT NULL,
  CONSTRAINT app_user_bungie_net_id_uk UNIQUE (bungie_net_id)
);
```

Notes:
- `bungie_net_id` is unique and indexed via the constraint — used for OAuth lookup on every login.
- No destiny membership IDs stored here. The per-listing founder destiny ID lives on `clan_listing` (Bungie reports founder as a destiny membership, not a 254 ID).

### `clan_listing`

A published clan. Only `PUBLISHED` rows exist — delist hard-deletes.

```sql
CREATE TABLE clan_listing (
  id                       UUID PRIMARY KEY,
  bungie_group_id          TEXT NOT NULL,
  owner_user_id            UUID NOT NULL REFERENCES app_user(id),
  owner_destiny_id         TEXT NOT NULL,        -- Bungie's founder.destinyUserInfo.membershipId at publish
  owner_membership_type    INT NOT NULL,         -- paired with owner_destiny_id (1/2/3/5/6)
  discord_url              TEXT,
  language                 TEXT NOT NULL,        -- 'English', 'Russian', ... (validated app-side)
  region                   TEXT NOT NULL,        -- 'AMERICAS' | 'EUROPE' | 'ASIA_PACIFIC'
  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL,
  version                  INT NOT NULL,
  CONSTRAINT clan_listing_bungie_group_id_uk UNIQUE (bungie_group_id)
);

CREATE INDEX clan_listing_owner_user_id_idx ON clan_listing(owner_user_id);
CREATE INDEX clan_listing_updated_at_idx ON clan_listing(updated_at DESC);
```

Notes:
- `owner_destiny_id` + `owner_membership_type` are what the auto-delist cron compares against Bungie's current `founder.destinyUserInfo.membershipId`. Mismatch → hard delete.
- `updated_at` index supports the default board sort (recent activity first).
- Owner edit verification doesn't touch this destiny ID — it uses `GetGroupsForMember(bungieNetId, 254)` and checks `isFounder` on Bungie's side.

### `clan_listing_playstyle_tag`

Owner-picked playstyle tags. Many-to-many.

```sql
CREATE TABLE clan_listing_playstyle_tag (
  clan_listing_id    UUID NOT NULL REFERENCES clan_listing(id) ON DELETE CASCADE,
  tag                TEXT NOT NULL,   -- 'PvE', 'Hardcore PvE', 'Raids', ...
  PRIMARY KEY (clan_listing_id, tag)
);

CREATE INDEX clan_listing_playstyle_tag_tag_idx ON clan_listing_playstyle_tag(tag);
```

### `clan_listing_platform`

Owner-picked platforms (moved from Bungie-derived to owner-supplied).

```sql
CREATE TABLE clan_listing_platform (
  clan_listing_id    UUID NOT NULL REFERENCES clan_listing(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,   -- 'PC' | 'PLAYSTATION' | 'XBOX'
  PRIMARY KEY (clan_listing_id, platform)
);

CREATE INDEX clan_listing_platform_platform_idx ON clan_listing_platform(platform);
```

### `bungie_clan_snapshot`

Cached basic clan data from Bungie. One row per published clan. Refreshed by the 6-hour cron.

```sql
CREATE TABLE bungie_clan_snapshot (
  bungie_group_id    TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  motto              TEXT,
  description        TEXT,
  banner_url         TEXT,
  member_count       INT NOT NULL,
  clan_level         INT,
  clan_level_max     INT,
  membership_type    TEXT NOT NULL,   -- 'OPEN' | 'APPLICATION' | 'CLOSED'
  founder_destiny_id TEXT NOT NULL,
  founder_membership_type INT NOT NULL,
  bungie_created_at  TIMESTAMPTZ NOT NULL,
  fetched_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX bungie_clan_snapshot_member_count_idx ON bungie_clan_snapshot(member_count);
CREATE INDEX bungie_clan_snapshot_membership_type_idx ON bungie_clan_snapshot(membership_type);
```

Notes:
- No index for name search: it's a case-insensitive **substring** match (`ILIKE '%…%'`, decided — see [be.md](./be.md)), which a btree can't serve anyway. Sequential scan is fine at v1 scale; add a `pg_trgm` GIN index if the table ever reaches tens of thousands of rows.
- `member_count` index supports min/max filter + size-tag derivation (`<20` → Small, `>50` → Big).
- No `platforms` column — moved to owner-supplied (`clan_listing_platform`).
- `founder_destiny_id` + `founder_membership_type` here mirror the live Bungie state; `clan_listing.owner_destiny_id` mirrors the *publish-time* state. Cron compares the two.

### `bungie_member_snapshot`

Cached member list per clan. Refreshed by the 24-hour cron.

```sql
CREATE TABLE bungie_member_snapshot (
  bungie_group_id    TEXT NOT NULL,
  destiny_id         TEXT NOT NULL,
  membership_type    INT NOT NULL,
  display_name       TEXT,
  display_name_code  INT,
  icon_path          TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bungie_group_id, destiny_id)
);

CREATE INDEX bungie_member_snapshot_group_idx ON bungie_member_snapshot(bungie_group_id);
```

## Cascade & delete behavior

- **Owner-initiated delist** or **auto-delist**: app-side transaction deletes `clan_listing` (cascades tags + platforms) and the corresponding `bungie_clan_snapshot` and `bungie_member_snapshot` rows. No FK between snapshots and listing — snapshots are keyed by `bungie_group_id`, not listing ID, so we clean them explicitly.
- **User deletion**: not supported in v1. If ever added, must delist all their clans first.

## Auto-derived (not stored)

- **Size tags** (`Small Clan`, `Big Clan`): computed from `bungie_clan_snapshot.member_count` at query time. Not persisted.
- **Sort by activity**: uses `clan_listing.updated_at`.

## What's NOT here

- No `taxonomy_tag` / `taxonomy_language` tables. Fixed lists; live in app constants. Revisit if owners ever need to propose new tags.
- No session / token storage. Sessions are a signed JWT cookie (Auth.js), user OAuth tokens are never persisted — see [auth.md](./auth.md).
- No soft-delete column on `clan_listing`. Delist = hard delete, per spec.
