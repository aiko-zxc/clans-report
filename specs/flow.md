# Clans Report — User Flows

End-to-end flows across UI, backend, Bungie API, and DB. Cross-references [auth.md](./auth.md) and [db.md](./db.md) where relevant.

Notation:
- `FE` = Next.js pages / client components
- `BE` = Next.js server side (route handlers + services; same app as FE)
- `Bungie` = Bungie API
- `DB` = our Postgres (Neon)

**FE caching rule:** the FE caches `/api/me` client-side. Refetched after any auth or listing mutation (login callback, logout, publish, edit save, delist). `/api/me` carries the user's listing too, so the manage page reads from the cached response — no second call.

---

## Visitor flows (no auth)

### V1. Land on the board

**Trigger:** user navigates to `/`.

```
FE → BE   GET  /api/me                                          → 401 (anonymous)
FE → BE   POST /api/clans/search   { page: 1, pageSize: 8 }     (empty filters)
BE → DB   SELECT clan_listing JOIN bungie_clan_snapshot
                JOIN aggregated tags/platforms
                ORDER BY clan_listing.updated_at DESC
                LIMIT 8 OFFSET 0
BE → FE   200 { items: [ClanCard, ...], total }
```

**FE renders:**
- Header CTA = "Log in" (from 401).
- Grid of 8 cards; each card shows banner, name, up to 3 tags + `+N`, member count.
- Pagination controls.

**Edge cases:**
- Zero clans published → empty-state card: "No clans yet — be the first to add yours."
- BE down → FE shows generic error page.

### V2. Apply filters

**Trigger:** user selects filters in left sidebar, clicks **Confirm**.

```
POST /api/clans/search
{
  "name": null,                  // optional substring (case-insensitive ILIKE; decided)
  "tags": ["PvE", "Raids"],      // playstyle tags — OR within
  "languages": ["English"],      // OR within
  "regions": ["AMERICAS"],       // OR within
  "platforms": [],               // OR within
  "membershipTypes": [],         // OR within
  "minMembers": 20,              // inclusive
  "maxMembers": null,            // inclusive
  "page": 1,
  "pageSize": 8
  // sort: omitted in v1 — server applies default (updated_at DESC)
}

BE → DB   SELECT ... WHERE
            EXISTS (tag join: PvE OR Raids)
            AND clan_listing.language IN ('English')
            AND clan_listing.region IN ('AMERICAS')
            AND bungie_clan_snapshot.member_count >= 20
          ORDER BY clan_listing.updated_at DESC
          LIMIT 8 OFFSET 0
```

**Tech notes:**
- Filters are AND across categories, OR within a category — implemented as separate `IN` / `EXISTS` clauses joined by `AND`.
- Name search semantics — **decided**: case-insensitive substring via `ILIKE '%…%'` (escaped), no index at v1 scale. See [be.md](./be.md).
- Size tag filters (`Small Clan` / `Big Clan`) map to `member_count < 20` or `> 50` — no separate column.
- No Bungie API calls on this path. Everything from cache.

**URL sharing:** because filters live in a POST body, deep-linkable filter URLs require the FE to mirror filter state into the URL (e.g., `/?tags=PvE,Raids&regions=AMERICAS`) and re-POST on load. The URL is the FE's concern; the BE only sees the body. Default v1 behavior: FE mirrors filters to URL query params for shareability.

### V3. View clan detail page

**Trigger:** user clicks a card or visits `/clan/{bungieGroupId}`.

```
FE → BE   GET /api/me                              → 401 or 200
FE → BE   GET /api/clans/{bungieGroupId}
BE → DB   SELECT clan_listing + bungie_clan_snapshot
                + tags + platforms
                + member list from bungie_member_snapshot
BE → FE   200 ClanDetail
```

**FE renders** (per the mockup layout):
- Left panel: owner name (from `bungie_clan_snapshot.founder_destiny_id` resolved via member snapshot for display), member count, membership type, creation date, language, region, playstyle tags, platforms, clan level + progress bar, Discord button, Bungie Page button.
- Right panel: banner, motto, description, member grid (icon + name#code).

**Staleness indicator:** if `bungie_clan_snapshot.fetched_at` is older than **12 hours** (cron runs every 6h; this gives one missed tick of grace), render a small "data may be outdated" notice. Signals Bungie API issues without breaking the page. Threshold is a shared app constant (see [be.md](./be.md) Configuration).

**Member rendering:** all members rendered, no pagination. A Destiny clan caps at 100 members, so the page renders at most ~100 avatar tiles. Acceptable DOM size for v1.

**Founder display name:** resolved by joining `bungie_clan_snapshot.founder_destiny_id` → `bungie_member_snapshot.destiny_id` for the same `bungie_group_id`. This is safe: the founder is always a member of their own clan in Destiny.

**Edge cases:**
- 404 (listing not found / delisted) → FE shows "This clan listing no longer exists."
- No Discord link → button hidden, not disabled.

---

## Owner flows (authenticated)

### O1. First login → publish (cold path)

**Trigger:** anonymous user clicks "Log in" (or "Add my clan" header CTA — both route through OAuth).

#### Login leg (Auth.js handles the dance)

```
FE → BE        signIn('bungie') → POST /api/auth/signin/bungie
Auth.js        Generates state, builds redirect URL
BE → FE        302 → https://www.bungie.net/en/OAuth/Authorize?client_id=...&state=...
User           Approves at bungie.net
Bungie → FE    302 → /api/auth/callback/bungie?code=...&state=...
Auth.js        Validates state
Auth.js → Bungie   POST <token URL> (code + client_id + client_secret)
                   → access_token
Auth.js → Bungie   GET /User/GetMembershipsForCurrentUser/ (with access_token)
                   → bungieNetId, displayName, displayNameCode

Our jwt callback (initial sign-in branch) runs:
BE → Bungie   GET /GroupV2/User/254/{bungieNetId}/0/1/ (with API key)
              → user's clan (at most 1) + isFounder flag
BE            Derive foundedBungieGroupId = (isFounder ? clan.groupId : null)
BE → DB       UPSERT app_user (by bungie_net_id) — set display_name, last_login_at
BE            Write JWT claims: userId, bungieNetId, displayName,
              displayNameCode, foundedBungieGroupId

Auth.js       Mints the session cookie, redirects
BE → FE       302 → / (or original "Add my clan" intent target)
              Set-Cookie: authjs.session-token=...; Max-Age=30d; HttpOnly; Secure; SameSite=Lax
              (access_token goes out of scope — never persisted, never in the JWT)
```

#### Publish leg

After login redirect, FE re-fetches `/api/me`:

```
FE → BE   GET /api/me   → 200 { displayName, displayNameCode, isFounder: true, listing: null }
FE        Header renders "Add my clan" → user clicks → navigate to /publish
FE → BE   GET /api/clans/preview
BE        Read session.foundedBungieGroupId
BE → Bungie   GET /GroupV2/{groupId} (API key) — basic clan info
BE → FE   200 BungiePreview { name, motto, description, banner, memberCount, ... }
FE        Show preview (read-only Bungie fields) + form for:
              Discord URL (optional, validated as URL)
              Language (dropdown from fixed taxonomy)
              Region (radio: Americas / Europe / Asia-Pacific)
              Playstyle tags (multi-select chips)
              Platforms (multi-select chips)
User      Submits
FE → BE   POST /api/me/listing
            { discordUrl, language, region, tags[], platforms[] }
BE        Re-validate session is present + isFounder via fresh Bungie call:
BE → Bungie   GET /GroupV2/User/254/{bungieNetId}/0/1/
              → confirm user is founder of session.foundedBungieGroupId
              → 403 NOT_FOUNDER if mismatch
BE → Bungie   GET /GroupV2/{groupId} + GetMembersOfGroup
BE → DB   BEGIN
            INSERT bungie_clan_snapshot (full payload, fetched_at = now)
            INSERT bungie_member_snapshot rows (one per member)
            INSERT clan_listing (owner_user_id, owner_destiny_id, ...)
            INSERT clan_listing_playstyle_tag (one per tag)
            INSERT clan_listing_platform (one per platform)
          COMMIT
          (unique constraint on owner_user_id → 409 LISTING_ALREADY_EXISTS on dupes)
BE → FE   201 OwnerListing
FE        Refetch /api/me (now returns listing != null)
FE        Redirect → /clan/{bungieGroupId} (public detail page)
```

**Edge cases:**
- User isn't actually founder (stale session): BE returns 403, FE shows "You no longer found a clan in Destiny" and clears the form.
- Duplicate publish (race between two tabs): unique constraint on `clan_listing.owner_user_id` rejects the second insert with 409 Conflict.
- Bungie down during submit: BE returns 503; user retries.
- Discord URL fails validation: 400 with field error; FE highlights the field.

### O2. Returning login → edit existing listing

**Trigger:** returning user visits `/`, already has a valid session cookie.

```
FE → BE   GET /api/me   → 200 { displayName, isFounder: true,
                                 listing: { bungieGroupId, version, ..., bungiePreview } }
FE        Header renders "Edit my clan" → user clicks → navigate to /manage
FE        Render edit form prefilled from cached /api/me.listing
          (no extra fetch needed)
User      Modifies fields, submits
FE → BE   PUT /api/me/listing
            { version, discordUrl, language, region, tags[], platforms[] }
BE        Read session.userId
BE → DB   SELECT clan_listing WHERE owner_user_id = ?
BE → Bungie   GET /GroupV2/User/254/{bungieNetId}/0/1/  (verify still founder)
BE        If verification fails → see flow O5 (stale self-heal) → 410
BE → Bungie   GET /GroupV2/{groupId}  (refresh basic snapshot)
BE → DB   BEGIN
            UPDATE clan_listing SET (...), updated_at = now, version = version + 1
              WHERE id = ? AND version = ?   (optimistic locking)
              → 409 VERSION_CONFLICT if mismatch
            DELETE FROM clan_listing_playstyle_tag WHERE clan_listing_id = ?
            INSERT new tag rows
            DELETE FROM clan_listing_platform WHERE clan_listing_id = ?
            INSERT new platform rows
            UPDATE bungie_clan_snapshot (...) WHERE bungie_group_id = ?
          COMMIT
BE → FE   200 OwnerListing (refreshed, bumped version)
FE        Refetch /api/me (gets updated listing), stay on /manage, show success toast
```

**Tech notes:**
- The manage page does **not** trigger a Bungie founder check on load — it reads the cached `/api/me.listing`. The check happens only on `PUT` (save). Brief stale-data window is acceptable; save handler 410s if needed.
- Tags/platforms updated by full-replace (delete + insert) for simplicity. Volume is small (max ~10 tags + 3 platforms).
- Members snapshot is **not** refreshed here — it's heavy and the user can't see members on the edit page anyway. Members are refreshed by the 24h cron.

### O3. Delist (owner-initiated)

**Trigger:** user clicks "Delist" button on `/manage`.

```
FE        Show confirmation modal: "This will hard-delete your listing.
           Re-publishing later requires filling the form from scratch. Continue?"
User      Confirms
FE → BE   DELETE /api/me/listing
BE        Read session.userId; resolve listing by owner_user_id
BE → DB   BEGIN
            DELETE FROM bungie_member_snapshot WHERE bungie_group_id = ?
            DELETE FROM bungie_clan_snapshot WHERE bungie_group_id = ?
            DELETE FROM clan_listing WHERE owner_user_id = ?
              (cascades clan_listing_playstyle_tag + clan_listing_platform)
          COMMIT
BE → FE   204 No Content
FE        Refetch /api/me (now returns listing: null), redirect → / with toast
          → header CTA flips to "Add my clan"
```

**Tech notes:**
- No notification, no "are you sure?" beyond the modal.
- Cascades on `clan_listing_playstyle_tag` and `clan_listing_platform` are FK-driven.
- Snapshots aren't FK'd to listing — deleted explicitly in the same transaction.

### O4. Logout

**Trigger:** user clicks "Log out" in user menu.

```
FE → BE   signOut() → POST /api/auth/signout (Auth.js, CSRF-protected)
BE        Nothing to invalidate server-side — the session is the cookie
BE → FE   Set-Cookie: authjs.session-token=; Max-Age=0
FE        Clear local /api/me cache, redirect → /
          Next /api/me returns 401
```

Note the JWT trade-off: logout clears this browser's cookie; a copy of the token elsewhere stays valid until expiry (see [auth.md](./auth.md) "Session cookie theft").

Bungie's own session is untouched — user stays logged in at bungie.net.

### O5. Stale-listing self-heal

Not a user-initiated flow — happens transparently inside O2 (edit) when the `PUT /api/me/listing` Bungie founder re-check fails. The check does **not** run on `/api/me` reads (per O2 tech notes), so the user can sit on a stale-looking manage page until they try to save.

**Causes:**
- Clan deleted in Bungie.
- User left the clan.
- User got demoted from founder.
- User founded a new clan (different `bungie_group_id`) since publishing.

All cases collapse to the same Bungie response: `GetGroupsForMember` doesn't return the listing's `bungie_group_id` with `isFounder=true`.

```
(Inside PUT /api/me/listing, after the verify Bungie call:)
BE → DB   BEGIN
            DELETE bungie_member_snapshot rows for this group
            DELETE bungie_clan_snapshot for this group
            DELETE clan_listing (cascades tags/platforms)
          COMMIT
BE → FE   410 Gone
            { code: "STALE_LISTING_REMOVED",
              detail: "This listing is no longer linked to your Destiny account; it has been removed." }
FE        Show banner with the detail string
FE → BE   update()  — Auth.js session update; the jwt callback's update branch
          re-runs GetGroupsForMember and rewrites the foundedBungieGroupId claim
          (could become null, or a new group ID if user re-founded)
FE → BE   GET /api/me  (re-fetch to repaint header)
FE        Based on new state:
            isFounder=true, listing=null  → "Add my clan" CTA, suggest re-publishing
            isFounder=false               → user menu only, no clan CTA
```

**Tech notes:**
- 410 Gone is semantically correct — "the resource you're trying to edit no longer exists."
- This is the *only* path where session claims are refreshed after login (via the Auth.js `update()` trigger, driven by the FE on seeing the 410). All other reads treat the session as immutable until logout.

---

## System flows (background)

### S1. Basic snapshot refresh (cron — every 6h)

GitHub Actions scheduled workflow (`cron: '0 */6 * * *'`) running `scripts/refresh-basic.ts` as a plain Node process — direct DB + Bungie access, never through the deployed app. Concurrency bounded with `p-limit` for rate-limit safety. See [be.md](./be.md) "Cron scripts".

```
For each clan_listing (all published), scheduled through p-limit:
    BE → Bungie   GET /GroupV2/{bungie_group_id}
        ├─ 200 → compare founder.destinyUserInfo.membershipId
        │         vs clan_listing.owner_destiny_id
        │         ├─ match → UPDATE bungie_clan_snapshot (set fetched_at)
        │         └─ mismatch → AUTO-DELIST (see S3)
        ├─ 404 → AUTO-DELIST
        ├─ 5xx / timeout → skip this row, log, continue (snapshot stays as-is;
        │                  detail page shows "data may be outdated")
        └─ 429 (rate limit) → sleep, retry once; if still 429, abort batch,
                              resume next tick
```

**Tech notes:**
- No `ORDER BY fetched_at` — every tick processes every row (per decision in [db.md](./db.md)).
- **Concurrency:** `p-limit(N)` bounds in-flight Bungie requests well under Bungie's ~25 req/sec ceiling. `N` comes from `BUNGIE_CONCURRENCY`; default 5. Slow runs are fine — nobody waits on this job.
- Failures don't bubble — log and continue. Stale data is preferable to a broken cron.
- No overlap protection needed beyond the workflows' shared `concurrency: bungie-refresh` group (the ShedLock analog).

### S2. Member snapshot refresh (cron — every 24h)

Same structure as S1 (`scripts/refresh-members.ts`, daily schedule offset from S1) but calls `GET /GroupV2/{groupId}/Members/`.

```
For each clan_listing (same p-limit-bounded pattern as S1):
    BE → Bungie   GET /GroupV2/{bungie_group_id}/Members/
        ├─ 200 → BEGIN
        │           UPSERT bungie_member_snapshot
        │             ON CONFLICT (bungie_group_id, destiny_id)
        │             DO UPDATE SET display_name, display_name_code,
        │                            icon_path, fetched_at
        │           DELETE bungie_member_snapshot
        │             WHERE bungie_group_id = ? AND fetched_at < <tick_start>
        │           (removes members no longer in the clan)
        │         COMMIT
        ├─ 404 → AUTO-DELIST (clan disappeared — basic cron will catch it too)
        └─ errors → skip, log, continue
```

**Tech notes:**
- Upsert + delete-stale is chosen over delete-then-insert: keeps the member list non-empty for the entire transaction window and avoids a brief inconsistent state visible to readers.
- If a member changes display name, this refresh picks it up (24h lag is fine).

### S3. Auto-delist (triggered by S1 or S2)

```
Within the same transaction as the cron's row processing:
DB:  BEGIN
       DELETE bungie_member_snapshot WHERE bungie_group_id = ?
       DELETE bungie_clan_snapshot WHERE bungie_group_id = ?
       DELETE clan_listing WHERE bungie_group_id = ?
         (cascades clan_listing_playstyle_tag + clan_listing_platform)
     COMMIT
```

**No notifications.** The original owner finds out next time they log in (`/api/me` returns `hasListing: false`).

If the original owner ever logs in again, header CTA becomes "Add my clan" (if they still found *some* clan) or hidden (if not).

---

## State transition summary

```
                      ┌──────────────┐
                      │  Anonymous   │
                      └──────┬───────┘
                             │ OAuth login
                             ▼
                ┌─────────────────────────┐
                │  Logged in, not founder │
                └─────────────────────────┘
                    ▲                  │ Bungie state change
                    │ logout           │ (founds a clan)
                    │                  ▼
                ┌─────────────────────────┐
                │ Logged in, founder,     │
                │ no listing              │
                └──────┬──────────────────┘
                       │ publish (POST /api/clans)
                       ▼
                ┌─────────────────────────┐
       ┌──────► │ Logged in, founder,     │
       │        │ has listing             │ ──┐
       │        └─────────────────────────┘   │
       │                                       │
       │ edit (no-op state change)             │ delist (owner) OR
       │                                       │ auto-delist (cron)
       └───────────────────────────────────────┘
                       │
                       ▼ (back to "no listing")
```

---

## What's intentionally NOT a flow yet

- **Password reset** — no passwords.
- **Email verification** — no email.
- **Account merge** — one Bungie.net account = one app_user, no merges.
- **Listing ownership transfer** — explicitly out of scope. If the founder changes in Bungie, the old listing is auto-delisted and the new founder must republish from scratch.
- **Bulk import / admin UI** — out of v1 entirely.
- **Notifications** (in-app or email) — none.
