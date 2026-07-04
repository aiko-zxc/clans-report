# Clans Report — Auth

Two distinct concerns:
- **Server → Bungie**: our app's credentials for calling the Bungie API.
- **User → Us**: how visitors authenticate and stay logged in.

> Stack: **Auth.js** (next-auth v5) with its built-in Bungie provider, JWT session strategy — no session table. Supersedes the Spring Security OAuth2 Client + Spring Session JDBC design (2026-07).

## Server → Bungie

Bungie API has two auth layers, both from one app registration at `bungie.net/en/Application`. Two registrations exist in practice: **prod** (redirect on the Vercel domain) and **dev** (redirect `https://127.0.0.1:3000/api/auth/callback/bungie` — Bungie requires HTTPS and rejects the `localhost` hostname; `127.0.0.1` + `next dev --experimental-https` works, no tunnel needed).

### Credentials (env vars, never in DB)

```
BUNGIE_API_KEY        # X-API-Key header on every Bungie call
AUTH_BUNGIE_ID        # OAuth client_id (semi-public; Auth.js naming convention)
AUTH_BUNGIE_SECRET    # OAuth client_secret — server-to-server token exchange
AUTH_SECRET           # signs/encrypts the Auth.js JWT cookie
```

(The redirect URI is not an env var — Auth.js derives it as `<origin>/api/auth/callback/bungie`.)

### Which credential where

| Caller | Endpoint | Auth used |
|---|---|---|
| Cron (basic refresh) | `GetGroup` | API key only |
| Cron (members refresh) | `GetMembersOfGroup` | API key only |
| Login flow | `POST /Token` | client_id + client_secret |
| Login flow | `GetMembershipsForCurrentUser` | user access_token (only here) |
| Login flow | `GetGroupsForMember(bungieNetId, 254)` | API key only |
| Publish / edit verification | `GetGroupsForMember(bungieNetId, 254)` | API key only |

**Cron never needs user OAuth** — all data we cache is from public endpoints.

## User → Us

Standard OAuth 2.0 authorization code flow, used **only as identity proof**. No long-lived user tokens are stored. No extra OAuth scopes are requested — Bungie's default basic-profile grant covers `GetMembershipsForCurrentUser`, and the founder check is API-key-only (see clans-report.md auth flow).

### Implementation: Auth.js (next-auth v5)

One config file (`lib/auth.ts`) + one catch-all route (`app/api/auth/[...nextauth]/route.ts`). Auth.js handles:
- Building the authorization redirect URL.
- Generating and validating the `state` parameter (CSRF protection).
- Exchanging the authorization code for an access token at Bungie's token endpoint.
- Calling the userinfo endpoint (`GetMembershipsForCurrentUser`) with the access token.
- Minting, signing, and refreshing the JWT session cookie.

Our code provides:
- The Bungie provider entry (built-in provider; verify at implementation time that the `X-API-Key` header reaches the token + userinfo requests — customize the provider's request hooks if the built-in doesn't pass it).
- A `jwt` callback that, **on initial sign-in only**, runs the founder lookup and the `app_user` upsert (steps 6–8 below) and stores our claims in the token.
- A `session` callback that copies those claims onto `session.user` for `auth()` consumers.

### Login flow

```
1. User clicks "Add my clan" (or "Log in")
   → FE calls signIn('bungie')  →  POST /api/auth/signin/bungie
2. Auth.js builds redirect:
       https://www.bungie.net/en/OAuth/Authorize?client_id=...&state=<csrf>
3. User logs in at bungie.net, approves
4. Bungie redirects → GET /api/auth/callback/bungie?code=...&state=...
5. Auth.js validates state, exchanges code for access_token via
       POST <bungie token URL>  with client_id + client_secret
6. Auth.js calls userinfo: GET /User/GetMembershipsForCurrentUser/ (access_token)
       → bungieNetId, displayName, displayNameCode
7. Our jwt callback (initial sign-in branch) runs:
       GET /GroupV2/User/254/{bungieNetId}/0/1/  (API key)
           → user's clan (at most 1) + isFounder
           → derive foundedBungieGroupId | null
       UPSERT app_user (by bungie_net_id) — set display_name, last_login_at
8. Token claims written: userId (app_user.id), bungieNetId,
       displayName, displayNameCode, foundedBungieGroupId
9. Auth.js sets the session cookie and redirects to the original target (or /)
10. access_token goes out of scope — never persisted, never in the JWT
```

**Key simplification (unchanged):** the access token's only job is step 6. Every later Bungie call we need (founder verification, clan data) uses public endpoints with our API key + the `bungieNetId` claim. We don't store, refresh, or revoke user tokens.

### Session storage: JWT cookie, no DB

**Strategy `jwt`** — the session *is* the cookie: an encrypted, signed token holding our claims. No `SPRING_SESSION` analog, no session rows, no cleanup job.

Cookie config (Auth.js defaults, tuned):
- Name: `authjs.session-token` (`__Secure-` prefixed on HTTPS)
- `HttpOnly`, `Secure`, `SameSite=Lax`
- `maxAge: 30 days` — outlives browser restarts, "stay logged in" works
- Sessions survive deploys and server restarts by construction (nothing server-side to lose)

### Session claims

Carried in the JWT, not in `app_user`:

| Claim | Type | Source | Refreshed when |
|---|---|---|---|
| `userId` | UUID | `app_user.id` | Login only (stable) |
| `bungieNetId` | text | Bungie userinfo | Login only (stable) |
| `displayName` / `displayNameCode` | text / int | Bungie userinfo | Login only |
| `foundedBungieGroupId` | text \| null | Bungie at login | Login; self-heal `update()` (see below) |

`foundedBungieGroupId` is intentionally **not** persisted in `app_user` — transient Bungie state we don't babysit. See [db.md](./db.md) "What's NOT here".

**Staleness window:** if a user founds a clan in Destiny *after* logging in, the claim stays null until they log out and back in. Acceptable for v1; rare, self-correcting.

**Claim refresh lever:** Auth.js supports re-running the `jwt` callback with `trigger === 'update'` (client-side `update()` / server-side `unstable_update()`). The callback's update branch re-runs the `GetGroupsForMember` lookup and rewrites `foundedBungieGroupId`. Used by the 410 self-heal (below); available later for a "re-check my clan" button if the staleness window ever annoys anyone.

## `GET /api/me`

The single endpoint the frontend hits on every page mount to know what to render. Carries the user's listing too — the manage page reads from this cached response instead of a second call.

### Contract

```
# Anonymous
401 Unauthorized
(no body)

# Authenticated
200 OK
{
  "displayName": "Name",
  "displayNameCode": 1234,
  "isFounder": true,           # foundedBungieGroupId claim != null
  "listing": { ... } | null    # OwnerListing if user has one
}
```

Full `OwnerListing` shape is documented in [api.md](./api.md).

### Implementation

1. `auth()` decodes the cookie → claims. No DB hit for the session itself.
2. No session → 401.
3. `SELECT clan_listing JOIN bungie_clan_snapshot ... WHERE owner_user_id = ?` → builds `listing` or `null`.
4. `isFounder` = `foundedBungieGroupId != null`.
5. Return 200 with payload.

No Bungie API calls on this path. One DB read, safe on every page mount.

### Frontend handling

`401` is not an error here — it's the "anonymous" state. The frontend's global HTTP error handler must skip `/api/me` (and any other "soft-auth" endpoint).

```ts
const me = await fetch('/api/me');
if (me.status === 401) {
  // anonymous → render "Log in"
} else {
  const data = await me.json();
  // render based on isFounder + (data.listing != null)
}
```

### Frontend-derived CTA

Backend exposes facts; frontend composes the UI:

```ts
if (!loggedIn)                              → "Log in"
else if (isFounder && !listing)             → "Add my clan"
else if (isFounder && listing)              → "Edit my clan"
else                                        → no CTA, just user menu
```

This is the only UI logic the FE needs. Future surfaces (profile page, banners) reuse the same two facts.

## Action enforcement at endpoints

`/api/me` fields are **advisory** — pure rendering hints. The real gates live at the action endpoints, which re-verify everything from authoritative sources:

| Endpoint | Re-validates |
|---|---|
| `POST /api/me/listing` (publish) | Session present; user is founder of the claimed `foundedBungieGroupId` (live Bungie check); no existing listing (DB unique constraint on `owner_user_id`) |
| `PUT /api/me/listing` (edit) | Session present; user still founder of the listing's clan (live Bungie check); if not → hard-delete listing + snapshots, return 410 Gone |
| `DELETE /api/me/listing` (delist) | Session present; listing exists for this user |
| Logout | Auth.js clears the cookie (CSRF-protected form POST) |

Frontend bugs at worst cause a button to error on click — never bypass auth.

## Edge cases

### User loses founder role while logged in
- Header keeps showing "Edit my clan" until the claim refreshes.
- They click it → edit flow calls `GetGroupsForMember`, finds no match → hard-deletes listing + snapshots → 410; FE triggers `update()` to refresh the claim and shows: *"Your previous clan listing was removed — it's no longer linked to your account in Destiny."*
- Header re-renders correctly on next `/api/me` call.

### User founds a new clan while logged in
- `foundedBungieGroupId` claim is stale (still null).
- "Add my clan" stays hidden until re-login (or a future `update()`-based re-check).
- If they manually navigate to the publish page anyway, the server's live re-validation picks up the new founder status — but the guard reads the claim, so v1 behavior is: log out and back in.

### Stale listing (founded clan B, listing for clan A)
- Header shows "Edit my clan" (we have a listing).
- Edit flow detects the mismatch, deletes A's listing + snapshots, returns 410; FE calls `update()` (claim becomes B's group id), then offers "Add my clan" for B.
- All in one user gesture; no manual cleanup needed.

### Session cookie theft
- Standard cookie-auth risk. Mitigated by `HttpOnly` + `Secure` + `SameSite=Lax`.
- 30-day expiry caps the damage window.
- **JWT trade-off:** there is no server-side session to revoke — logout clears the browser's cookie but a stolen token stays valid until expiry. Accepted for v1 (nothing sensitive behind auth beyond editing one's own listing; every mutation re-verifies against Bungie anyway). Nuclear option: rotate `AUTH_SECRET`, which invalidates *all* sessions.

### Session expired but cookie present
- Auth.js rejects the expired JWT → `auth()` returns null → 401 → FE renders anonymous state.
- User clicks login → fresh OAuth flow.

### Bungie down during login
- Token exchange, userinfo, or the founder lookup fails → our `jwt`/`signIn` callback throws → Auth.js redirects to its error page → user retries.
- No partial state: `app_user` is upserted only after all Bungie calls succeed.

## What's NOT in v1

- **OAuth token persistence.** We don't need it (see flow above).
- **Refresh token rotation.** Same reason.
- **"Log out everywhere" / device management.** Impossible with pure JWT sessions without a denylist; defer until there's something worth protecting.
- **Email/password fallback.** Bungie OAuth only.
- **Roles / admin users.** No admin panel in v1.
- **Account deletion.** No GDPR tooling in v1; delist removes the only meaningful user content.
- **CSRF tokens for our own state-changing endpoints.** `SameSite=Lax` cookie + same-origin frontend covers this for v1 (Auth.js's own endpoints have built-in CSRF). Add explicit CSRF if we ever expose cross-origin clients.

## Endpoint summary

Auth.js owns everything under `/api/auth/*` (one catch-all route). Our own endpoints live beside it under `/api/*`.

```
POST   /api/auth/signin/bungie         # Auth.js: build OAuth URL, redirect (FE: signIn('bungie'))
GET    /api/auth/callback/bungie       # Auth.js: handle code, mint JWT cookie
POST   /api/auth/signout               # Auth.js: clear cookie (FE: signOut())
GET    /api/auth/session               # Auth.js: raw session claims (FE uses /api/me instead)

GET    /api/me                         # 401 or 200 with auth state + listing
GET    /api/clans/preview              # 401/403 or 200 with un-published clan data for the publish form
POST   /api/me/listing                 # publish
PUT    /api/me/listing                 # edit
DELETE /api/me/listing                 # delist
```
