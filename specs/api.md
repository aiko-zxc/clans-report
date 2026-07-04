# Clans Report — Backend API Contracts

REST + JSON, served by Next.js route handlers. All endpoints under `/api/*`; Auth.js owns `/api/auth/*`. Cross-references [auth.md](./auth.md), [db.md](./db.md), [flow.md](./flow.md).

## Conventions

- **Encoding:** `application/json; charset=utf-8` for all requests and responses with bodies.
- **JSON keys:** `camelCase`.
- **Timestamps:** ISO 8601 with offset, e.g. `"2026-05-17T10:30:00Z"`.
- **IDs:** strings.
  - Bungie IDs are 19-digit numeric strings.
  - Our internal IDs are UUIDs (only ever exposed for owner-facing entities).
- **Enums:** `UPPER_SNAKE_CASE` strings — `OPEN`, `APPLICATION`, `CLOSED`, `AMERICAS`, `EUROPE`, `ASIA_PACIFIC`, `PC`, `PLAYSTATION`, `XBOX`, `EPIC_GAMES`.
- **Languages and playstyle tags:** kept as their canonical display strings (`"English"`, `"Russian"`, `"PvE"`, `"Hardcore PvE"`) — these are part of the public contract; converting them to enums adds translation burden with no benefit.
- **Auth:** JWT session cookie set by Auth.js (`authjs.session-token`, `__Secure-` prefixed on HTTPS). Anonymous requests to protected endpoints → `401`. Authenticated requests without the right ownership → `403`.
- **Errors:** RFC 7807 `application/problem+json` via the shared `problem()` helper (see [be.md](./be.md)), with an extra `code` field for FE switching:

```jsonc
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "You already have a published listing.",
  "instance": "/api/clans",
  "code": "LISTING_ALREADY_EXISTS"
}
```

The `code` enum is what the FE switches on; `detail` is human-readable.

## Shared shapes

### `ClanCard` (board listing item)

```jsonc
{
  "bungieGroupId": "3960072",
  "name": "Moon Wolves",
  "bannerUrl": "https://www.bungie.net/img/...",
  "memberCount": 42,
  "tags": ["PvE", "Raids", "Hardcore PvE"]
}
```

Tags are playstyle tags only (owner-picked). Size tags (`Small Clan`, `Big Clan`) are filter-only — derived from `memberCount`, never returned in this list. FE truncates to 3 visible + `+N`.

### `ClanDetail` (public detail page)

```jsonc
{
  "bungieGroupId": "3960072",
  "name": "Moon Wolves",
  "motto": "Howl at the dark",
  "description": "We hunt every Friday...",
  "bannerUrl": "https://www.bungie.net/img/...",
  "memberCount": 42,
  "clanLevel": { "current": 5, "max": 6 },
  "membershipType": "OPEN",
  "bungieCreatedAt": "2020-09-08T00:00:00Z",
  "founder": {
    "displayName": "Howler",
    "displayNameCode": 1234
  },
  "language": "English",
  "region": "AMERICAS",
  "tags": ["PvE", "Raids"],
  "platforms": ["PC", "PLAYSTATION"],
  "contacts": {
    "discordUrl": "https://discord.gg/abc123"
  },
  "members": [
    {
      "destinyId": "4611686018429783584",
      "displayName": "Howler",
      "displayNameCode": 1234,
      "iconPath": "/common/destiny2_content/icons/abc.png"
    }
  ],
  "dataFetchedAt": "2026-05-17T08:00:00Z"
}
```

- `dataFetchedAt` = `bungie_clan_snapshot.fetched_at`. FE uses it to render the "data may be outdated" indicator if older than 12 hours.
- `contacts` is always present; individual fields inside may be `null` when not supplied. Nested under a block so future contact channels (e.g., Twitter, YouTube) slot in without breaking the contract.
- `members` is the full list (max ~100 — Destiny's clan cap). No pagination.

### `BungiePreview` (un-published clan data, for publish/edit forms)

```jsonc
{
  "bungieGroupId": "3960072",
  "name": "Moon Wolves",
  "motto": "Howl at the dark",
  "description": "...",
  "bannerUrl": "https://www.bungie.net/img/...",
  "memberCount": 42,
  "clanLevel": { "current": 5, "max": 6 },
  "membershipType": "OPEN",
  "bungieCreatedAt": "2020-09-08T00:00:00Z"
}
```

Subset of `ClanDetail` — only the Bungie-sourced fields the owner needs to see before filling the editorial form.

### `OwnerListing` (owner's view of their own listing, embedded in `/api/me`)

```jsonc
{
  "bungieGroupId": "3960072",
  "version": 3,
  "contacts": {
    "discordUrl": "https://discord.gg/abc123"
  },
  "language": "English",
  "region": "AMERICAS",
  "tags": ["PvE", "Raids"],
  "platforms": ["PC", "PLAYSTATION"],
  "bungiePreview": { /* BungiePreview */ }
}
```

`version` is the optimistic-locking value. FE must echo it back in `PUT /api/me/listing`.

Embedded in `/api/me.listing`. There is no separate `GET /api/me/listing` endpoint — the manage page reads from the already-cached `/api/me` response.

## Endpoints

### `POST /api/clans/search` — board listing

**Auth:** anonymous.

**Request:**
```jsonc
{
  "name": null,                    // string | null — case-insensitive substring (ILIKE; decided)
  "tags": ["PvE", "Raids"],        // string[]   — OR within
  "languages": ["English"],        // string[]   — OR within
  "regions": ["AMERICAS"],         // enum[]     — OR within
  "platforms": ["PC"],             // enum[]     — OR within
  "membershipTypes": ["OPEN"],     // enum[]     — OR within
  "minMembers": 20,                // int | null — inclusive
  "maxMembers": null,              // int | null — inclusive
  "page": 1,                       // 1-based
  "pageSize": 8                    // 1..50 (server caps)
}
```

All fields are optional except `page` and `pageSize`. Empty/missing arrays mean "no filter on this category."

**Response 200:**
```jsonc
{
  "items": [ /* ClanCard */ ],
  "total": 156,
  "page": 1,
  "pageSize": 8
}
```

**Errors:**
- `400 INVALID_REQUEST` — unknown enum value, `pageSize > 50`, `minMembers > maxMembers`, etc.

### `GET /api/clans/{bungieGroupId}` — detail page

**Auth:** anonymous.

**Path params:**
- `bungieGroupId` — Bungie group ID (19-digit string).

**Response 200:** `ClanDetail`.

**Errors:**
- `404 LISTING_NOT_FOUND` — never published, or delisted.

### `GET /api/clans/preview` — un-published clan preview for the publish form

**Auth:** required (session with `foundedBungieGroupId != null`).

The server derives the clan ID from `session.foundedBungieGroupId` — no query params or body. This prevents a logged-in user from previewing arbitrary clans.

**Response 200:** `BungiePreview`.

**Errors:**
- `401 UNAUTHENTICATED` — no session.
- `403 NOT_FOUNDER` — `session.foundedBungieGroupId` is null (user doesn't found any clan in Destiny).
- `503 BUNGIE_UNAVAILABLE` — Bungie API failed.

### `POST /api/me/listing` — publish

**Auth:** required.

**Request:**
```jsonc
{
  "contacts": {
    "discordUrl": "https://discord.gg/abc123"   // string | null — https, Discord-only host
  },
  "language": "English",                         // must be in fixed taxonomy
  "region": "AMERICAS",                          // AMERICAS | EUROPE | ASIA_PACIFIC
  "tags": ["PvE", "Raids"],                      // each must be in fixed playstyle taxonomy
  "platforms": ["PC", "PLAYSTATION"]             // each: PC | PLAYSTATION | XBOX | EPIC_GAMES
}
```

The clan being published is derived from `session.foundedBungieGroupId` — not from the request body. This eliminates an entire class of "publish someone else's clan" bugs.

**Response 201:** `OwnerListing` (the freshly-created listing).

**Errors:**
- `400 INVALID_REQUEST` — validation (bad Discord URL host, unknown tag, missing required field).
- `401 UNAUTHENTICATED`.
- `403 NOT_FOUNDER` — session says no founded clan, **or** live Bungie re-check fails.
- `409 LISTING_ALREADY_EXISTS` — unique constraint on `clan_listing.owner_user_id` was violated.
- `503 BUNGIE_UNAVAILABLE` — couldn't fetch snapshot during publish.

### `PUT /api/me/listing` — edit

**Auth:** required + has a listing (session-resolved, no id needed).

**Request:**
```jsonc
{
  "version": 3,                                 // optimistic lock — from OwnerListing.version
  "contacts": {
    "discordUrl": "https://discord.gg/abc123"
  },
  "language": "English",
  "region": "AMERICAS",
  "tags": ["PvE", "Raids"],
  "platforms": ["PC"]
}
```

**Response 200:** `OwnerListing` (refreshed, with bumped `version`).

**Errors:**
- `400 INVALID_REQUEST`.
- `401 UNAUTHENTICATED`.
- `404 NO_LISTING` — user has no published listing.
- `409 VERSION_CONFLICT` — `version` in request doesn't match DB; client must refetch via `/api/me`.
- `410 STALE_LISTING_REMOVED` — live Bungie check showed user is no longer founder of the listing's clan; the listing has been hard-deleted. FE handles per O5 in [flow.md](./flow.md):
  ```jsonc
  {
    "status": 410, "code": "STALE_LISTING_REMOVED",
    "detail": "This listing is no longer linked to your Destiny account; it has been removed."
  }
  ```
- `503 BUNGIE_UNAVAILABLE`.

### `DELETE /api/me/listing` — owner-initiated delist

**Auth:** required + has a listing.

**Request:** empty body.

**Response 204** — no body.

**Errors:**
- `401 UNAUTHENTICATED`.
- `404 NO_LISTING` — user has no published listing.

### `GET /api/me` — auth state + listing for the header and manage page

**Auth:** required.

**Response 200:**
```jsonc
{
  "displayName": "Howler",
  "displayNameCode": 1234,
  "isFounder": true,
  "listing": { /* OwnerListing */ } | null
}
```

`isFounder` is derived from `session.foundedBungieGroupId != null` (set at login).
`listing` is `OwnerListing` if the user has one, else `null`. FE uses `listing != null` to render "Edit my clan" vs "Add my clan".

This endpoint does **no Bungie API calls** — pure DB read, safe to hit on every page mount. The Bungie founder re-check happens at action time (`PUT`/`DELETE /api/me/listing`), not on `GET /api/me`. Consequence: the manage page can briefly show stale data until the user attempts to save; the save handler then 410s and triggers the self-heal banner. Acceptable race for v1.

**Response 401:** no body — treated by the FE as "anonymous user", not an error.

### Auth.js endpoints (`/api/auth/*`)

Owned by Auth.js — documented in [auth.md](./auth.md). No JSON contracts of ours; the FE uses the `signIn('bungie')` / `signOut()` helpers rather than calling them directly.

- `POST /api/auth/signin/bungie` — initiates OAuth (CSRF-protected form POST → 302 to Bungie).
- `GET /api/auth/callback/bungie` — OAuth callback, mints the session cookie.
- `POST /api/auth/signout` — clears the session cookie (the logout endpoint; there is no separate `/api/auth/logout`).
- `GET /api/auth/session` — Auth.js's raw session claims; the FE uses `/api/me` instead (it carries the listing too).

## Error codes (full list)

Stable strings the FE can switch on:

| Code | Typical status | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 | Body/validation failure |
| `UNAUTHENTICATED` | 401 | No session |
| `NOT_FOUNDER` | 403 | Authenticated but doesn't found a Destiny clan |
| `LISTING_NOT_FOUND` | 404 | Public detail on nonexistent/delisted listing |
| `NO_LISTING` | 404 | Owner has no listing (edit/delist attempt without publishing) |
| `LISTING_ALREADY_EXISTS` | 409 | Publish hit unique constraint |
| `VERSION_CONFLICT` | 409 | Optimistic lock failure on edit |
| `STALE_LISTING_REMOVED` | 410 | Self-heal triggered, listing deleted |
| `BUNGIE_UNAVAILABLE` | 503 | Bungie API failed during a sync call |

## Validation rules (server-enforced)

- `contacts.discordUrl`: optional; if present, must match `^https://(discord\.gg|discord\.com)/.+`. Strips trailing whitespace. Length ≤ 200.
- `contacts`: object always required in requests; individual fields inside may be null/omitted.
- `language`: must be one of the fixed taxonomy values (currently `English`, `Russian`, `German`, `French`, `Español`, `Ukrainian`, `Polski`).
- `region`: enum.
- `tags`: each must be in the fixed playstyle taxonomy. Max 9 (size of the taxonomy). Deduplicated server-side.
- `platforms`: each enum. Max 4. Deduplicated. At least 1.
- `name` filter: max 64 chars.
- `pageSize`: 1..50; values outside are 400.
- `minMembers` / `maxMembers`: 0..100; if both present, `min <= max`.

## What's NOT here

- **Admin endpoints** — no admin panel in v1.
- **Webhooks / event emission** — no consumers in v1.
- **Bulk operations** — single-resource CRUD only.
- **Taxonomy management endpoints** — fixed lists, app-side constants. If the taxonomy ever becomes user-editable, add `GET /api/taxonomy/*` then.
- **`PATCH`** — `PUT` is full-replace; we don't have partial-update use cases.
- **Token/refresh endpoints** — we don't store user tokens. See [auth.md](./auth.md).
