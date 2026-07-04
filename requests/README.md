# Manual API requests

Runnable `.http` files for the **VS Code REST Client** extension
(`humao.rest-client`). Click **Send Request** above any block; the response opens
in a split pane.

## Setup

1. Install the REST Client extension.
2. Copy `.env.example` → `.env` at the repo root and fill values (`.env` is gitignored).
3. Pick an environment from the VS Code status bar (bottom-right): `local`,
   `local-https`, or `prod`. Requests use `{{baseUrl}}` from it
   (see `.vscode/settings.json`).

## Files

- **`bungie.http`** — direct Bungie API calls. Needs only `BUNGIE_API_KEY`. No app
  running, no login. Edit the `@groupId` / `@bungieNetId` at the top to explore a
  real clan / account.
- **`clans.http`** — our public endpoints (search, detail). Anonymous — run against
  a running `local` dev server. *(added in CR-6/CR-7)*
- **`me.http`** — our authenticated endpoints. Needs a session cookie. *(added in CR-13+)*

## Session cookie (for authenticated requests)

Log in once in the browser (`https://127.0.0.1:3000`), then from DevTools →
Application → Cookies copy the value of `authjs.session-token`
(`__Secure-authjs.session-token` on prod) into `.env` as `SESSION_COOKIE`.
Valid ~30 days. Authenticated requests send it via `{{$dotenv SESSION_COOKIE}}`.

## HTTPS note

Bungie's HTTPS requirement applies only to the browser-side OAuth redirect at
login — it does **not** affect these manual requests. `local` (plain
`http://localhost:3000`) is fine for anonymous endpoints; use `local-https` only
when exercising auth. If REST Client rejects the local dev cert, disable
certificate validation for localhost in the extension settings.
