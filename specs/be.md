# Clans Report — Backend Implementation

One full-stack **Next.js** app (App Router, TypeScript): pages and API in a single deployable. **Drizzle ORM** + **drizzle-kit** over Neon Postgres, **Auth.js** for Bungie OAuth, **GitHub Actions** for crons, deployed to **Vercel** (serverless). Cross-references [api.md](./api.md), [auth.md](./auth.md), [db.md](./db.md), [flow.md](./flow.md).

> Supersedes the previous Spring Boot / JOOQ / Oracle-VM plan (2026-07). The product, flows, API contracts, and schema are unchanged; only the implementation stack moved.

## Project layout

```
clans-report/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                        # board (server component, direct DB read for first paint)
│   ├── clan/[id]/page.tsx              # public detail page
│   ├── publish/page.tsx                # owner: publish form
│   ├── manage/page.tsx                 # owner: edit/delist
│   └── api/
│       ├── auth/[...nextauth]/route.ts # Auth.js — signin/callback/signout/session
│       ├── clans/search/route.ts       # POST /api/clans/search
│       ├── clans/preview/route.ts      # GET  /api/clans/preview
│       ├── clans/[id]/route.ts         # GET  /api/clans/{bungieGroupId}
│       ├── me/route.ts                 # GET  /api/me
│       └── me/listing/route.ts         # POST / PUT / DELETE /api/me/listing
├── lib/
│   ├── db/
│   │   ├── client.ts                   # drizzle + pg Pool
│   │   ├── schema.ts                   # all tables — single source of truth for migrations
│   │   └── repos/
│   │       ├── app-user-repo.ts
│   │       ├── clan-listing-repo.ts
│   │       └── snapshot-repo.ts        # clan + member snapshots
│   ├── services/
│   │   ├── board-service.ts
│   │   ├── listing-service.ts          # publish / edit / delist orchestration
│   │   ├── me-service.ts
│   │   ├── preview-service.ts
│   │   └── sync-service.ts             # snapshot refresh + auto-delist (shared with scripts/)
│   ├── bungie/
│   │   ├── client.ts                   # fetch wrapper: X-API-Key, retry, error mapping
│   │   └── types.ts                    # Bungie wire shapes, internal
│   ├── auth.ts                         # Auth.js config (see auth.md)
│   ├── guards.ts                       # requireSession() / requireFounder()
│   ├── errors.ts                       # AppError, ErrorCode, problem+json helpers
│   ├── validation.ts                   # zod schemas per api.md
│   └── taxonomy.ts                     # fixed tag/language/platform lists
├── scripts/
│   ├── refresh-basic.ts                # cron S1 — run via tsx (reuses lib/)
│   ├── refresh-members.ts              # cron S2
│   └── seed.ts                         # local dev: fake listings for the board
├── drizzle/                            # generated SQL migrations (see db.md)
├── drizzle.config.ts
├── test/                               # vitest integration tests + helpers
└── .github/workflows/
    ├── ci.yml                          # tests on PR + push; migrations on main
    ├── refresh-basic.yml               # schedule: every 6h
    └── refresh-members.yml             # schedule: every 24h
```

## Layer responsibilities

- **Route handler** (`app/api/**/route.ts`) — HTTP only. Parses/validates the body with zod, resolves the session via guards, calls one service function, maps the result to a response. No SQL. No Bungie calls. The analog of a controller.
- **Service** (`lib/services/`) — business logic, orchestration, transaction boundaries. Composes repos + the Bungie client. Throws `AppError`; never touches `Request`/`Response` types.
- **Repo** (`lib/db/repos/`) — Drizzle-only. Every query in the codebase lives here. Accepts/returns plain domain objects typed from the schema (`InferSelectModel`). No service logic.
- **Bungie** (`lib/bungie/`) — HTTP client + response mapping. Translates Bungie wire shapes into our domain shapes; nothing outside this folder knows Bungie's JSON structure.
- **Server components** (`app/**/page.tsx`) — may call services directly for first-paint reads (board, detail page); all mutations and client-side refetches go through `/api/*`. The public API contract in [api.md](./api.md) is served in full regardless.

## Database access (Drizzle)

- **Driver:** `drizzle-orm/node-postgres` + `pg` `Pool` everywhere — Vercel functions, cron scripts, tests. One driver, full transaction support, and Testcontainers parity. (The `neon-http` driver was rejected: no interactive transactions, and tests would run a different driver than prod.)
- **Connection string:** Neon's **pooled** endpoint (`-pooler` host) in prod — serverless functions scale horizontally, so each instance keeps `max: 1` in its `Pool` and PgBouncer does the real pooling. Scripts and local dev use the direct endpoint.

```ts
// lib/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
export const db = drizzle(pool, { schema });
```

- **Transactions are explicit** — `db.transaction(async tx => { ... })` in services when more than one statement must commit atomically (publish, delist, self-heal). Repos accept an optional `tx` handle so the same functions work inside and outside transactions.

```ts
// lib/services/listing-service.ts (delist)
await db.transaction(async tx => {
  await snapshotRepo.deleteMembers(tx, groupId);
  await snapshotRepo.deleteClan(tx, groupId);
  await clanListingRepo.deleteByOwner(tx, userId); // cascades tags + platforms
});
```

### Optimistic locking

No framework magic — the `version` check is explicit and the row count is asserted:

```ts
// lib/db/repos/clan-listing-repo.ts
const updated = await tx.update(clanListing)
  .set({ ...changes, version: sql`${clanListing.version} + 1`, updatedAt: new Date() })
  .where(and(eq(clanListing.id, id), eq(clanListing.version, expectedVersion)))
  .returning();
if (updated.length === 0) throw new AppError('VERSION_CONFLICT',
  'Listing was modified concurrently; refetch and retry.');
```

## Bungie HTTP client

```ts
// lib/bungie/client.ts
const BASE = process.env.BUNGIE_API_BASE_URL ?? 'https://www.bungie.net/Platform';

export async function bungieGet<T>(path: string, mapper: (raw: unknown) => T): Promise<T> {
  const attempt = () => fetch(`${BASE}${path}`, {
    headers: { 'X-API-Key': process.env.BUNGIE_API_KEY! },
  });

  let res = await attempt().catch(() => null);
  if (!res || res.status >= 500) res = await attempt().catch(() => null); // one retry on 5xx / network
  if (!res || res.status >= 500) throw new AppError('BUNGIE_UNAVAILABLE', 'Bungie API failed.');
  if (res.status === 404) throw new BungieNotFound(path);
  if (!res.ok) throw new AppError('BUNGIE_UNAVAILABLE', `Bungie returned ${res.status}.`);
  return mapper(await res.json());
}
```

- **Retry policy:** one retry on 5xx or network error; no retry on 4xx. 429 handling lives in the cron scripts only (see below) — request-path calls are 2–3 per user gesture and never approach the limit.
- **No circuit breaker, no semaphore.** Serverless instances share no memory, so Resilience4j-style stateful protection is meaningless here. The request path degrades per-call (503 → user retries); batch-path rate limiting is `p-limit` in the scripts.
- The one Bungie call that uses a **user access token** (identity at login) lives inside the Auth.js flow, not this client — see [auth.md](./auth.md).

## Validation (zod)

Zod schemas in `lib/validation.ts` mirror the rules in [api.md](./api.md) — the Bean Validation analog. Route handlers parse with `schema.safeParse`; failures map to `400 INVALID_REQUEST` with the issue messages joined.

```ts
export const publishListingRequest = z.object({
  contacts: z.object({
    discordUrl: z.string().max(200)
      .regex(/^https:\/\/(discord\.gg|discord\.com)\/.+$/, 'discordUrl must be a Discord URL')
      .nullable(),
  }),
  language: z.enum(LANGUAGES),          // fixed taxonomy — zod enforces membership at parse time
  region: z.enum(REGIONS),
  tags: z.array(z.enum(PLAYSTYLE_TAGS)).min(1).max(PLAYSTYLE_TAGS.length),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length),
});

export const searchClansRequest = z.object({
  name: z.string().max(64).nullish(),
  tags: z.array(z.enum(PLAYSTYLE_TAGS)).default([]),
  languages: z.array(z.enum(LANGUAGES)).default([]),
  regions: z.array(z.enum(REGIONS)).default([]),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  membershipTypes: z.array(z.enum(MEMBERSHIP_TYPES)).default([]),
  minMembers: z.number().int().min(0).max(100).nullish(),
  maxMembers: z.number().int().min(0).max(100).nullish(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(50),
}).refine(r => r.minMembers == null || r.maxMembers == null || r.minMembers <= r.maxMembers,
  { message: 'minMembers must be <= maxMembers' });
```

Taxonomy membership (is `"English"` a valid language?) is enforced **at parse time** via `z.enum` over the taxonomy constants — an improvement over the Java plan, where it was a separate service-layer check. Tags/platforms are deduplicated (`new Set`) in the service before persisting.

### Name search (decided)

Case-insensitive **substring** match: `ILIKE '%' || escaped(name) || '%'` with `%`/`_` escaped. Sequential scan — fine at v1 scale (hundreds of rows). If the table ever reaches tens of thousands of rows, add a `pg_trgm` GIN index; do not pre-build it now.

## Error handling

`ErrorCode` matches the table in [api.md](./api.md) 1:1:

```ts
// lib/errors.ts
export const ERROR_STATUS = {
  INVALID_REQUEST: 400, UNAUTHENTICATED: 401, NOT_FOUNDER: 403,
  LISTING_NOT_FOUND: 404, NO_LISTING: 404,
  LISTING_ALREADY_EXISTS: 409, VERSION_CONFLICT: 409,
  STALE_LISTING_REMOVED: 410, BUNGIE_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}

export function problem(code: ErrorCode, detail: string, instance?: string) {
  const status = ERROR_STATUS[code];
  return Response.json(
    { type: 'about:blank', title: httpStatusText(status), status, detail, instance, code },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
```

Every route handler body is wrapped by a single higher-order function — the `@RestControllerAdvice` analog:

```ts
// lib/errors.ts
export function handled(handler: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try { return await handler(req, ctx); }
    catch (e) {
      if (e instanceof AppError) return problem(e.code, e.message, new URL(req.url).pathname);
      console.error(e);
      return problem('BUNGIE_UNAVAILABLE' /* or a generic 500 */, 'Unexpected error.');
    }
  };
}
```

```ts
// app/api/me/listing/route.ts — the controller shape
export const POST = handled(async req => {
  const user = await requireFounder();                       // 401 / 403 via AppError
  const body = parse(publishListingRequest, await req.json()); // 400 via AppError
  const listing = await listingService.publish(user, body);
  return Response.json(listing, { status: 201 });
});
```

## Auth guards

The `@PreAuthorize` analog — small helpers over Auth.js's `auth()` (see [auth.md](./auth.md) for what's in the session):

```ts
// lib/guards.ts
export async function requireSession(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) throw new AppError('UNAUTHENTICATED', 'Authentication required.');
  return session.user as SessionUser;
}

export async function requireFounder(): Promise<SessionUser> {
  const user = await requireSession();
  if (!user.foundedBungieGroupId) throw new AppError('NOT_FOUNDER', "You don't found a Destiny clan.");
  return user;
}
```

Resource-state checks (`hasListing`, `isStillFounderInBungie`) stay in the service layer, same reasoning as before: the service needs the row anyway, and the error mapping (`NO_LISTING`, `STALE_LISTING_REMOVED`) lives where the business decision is made.

## Cron scripts (GitHub Actions)

The S1/S2 flows from [flow.md](./flow.md), as plain Node processes run by scheduled workflows. **They never go through the deployed app** — direct DB + Bungie access, reusing `lib/services/sync-service.ts`. Run with `tsx` so they share the app's TypeScript code.

```ts
// scripts/refresh-basic.ts
import pLimit from 'p-limit';

const limit = pLimit(Number(process.env.BUNGIE_CONCURRENCY ?? 5));
const listings = await clanListingRepo.allPublished(db);
const results = await Promise.allSettled(
  listings.map(l => limit(() => syncService.refreshBasic(l))),
);
console.log(summarize(results)); // counts: ok / skipped / auto-delisted / failed
```

- **Rate limiting:** `p-limit(5)` bounds in-flight Bungie calls — deliberately far under the ~25 req/s ceiling. Slow is fine: nobody waits on this job (board reads from cache; freshness SLA is the cron interval, not the job duration).
- **429 handling:** sleep `ThrottleSeconds` from the response, retry once; if still 429, log and exit 0 — the next tick resumes. Same policy as the old spec's "abort batch, resume next tick".
- **Failures don't bubble:** per-listing errors are caught in `refreshBasic` (logged, snapshot left as-is). Stale data is preferable to a broken cron.
- **Auto-delist (S3)** runs inside the same per-listing transaction, per flow.md.

```yaml
# .github/workflows/refresh-basic.yml
name: refresh-basic
on:
  schedule: [{ cron: '0 */6 * * *' }]
  workflow_dispatch: {}                 # manual "refresh now" button
concurrency: { group: bungie-refresh } # never overlap with refresh-members (ShedLock analog)
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsx scripts/refresh-basic.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BUNGIE_API_KEY: ${{ secrets.BUNGIE_API_KEY }}
```

`refresh-members.yml` is identical with `cron: '30 2 * * *'` (daily, offset from the 6h job) and the other script. GitHub schedule triggers can drift 5–15 min — irrelevant at these cadences.

## Configuration

No profiles — environment variables per environment:

| Variable | Local (`.env.local`) | Vercel (preview/prod) | GH Actions (crons/CI) |
|---|---|---|---|
| `DATABASE_URL` | local Docker PG or Neon dev branch | Neon pooled endpoint | Neon direct endpoint (secret) |
| `AUTH_SECRET` | `npx auth secret` | secret | — |
| `AUTH_URL` | `https://127.0.0.1:3000` | auto-detected | — |
| `AUTH_BUNGIE_ID` / `AUTH_BUNGIE_SECRET` | **dev** Bungie app | **prod** Bungie app (secret) | — |
| `BUNGIE_API_KEY` | dev app key | prod app key (secret) | secret |
| `BUNGIE_CONCURRENCY` | — | — | optional, default 5 |

- Check in `.env.example` with every key and a comment; `.env.local` is gitignored.
- Staleness threshold (12h, drives the "data may be outdated" badge) is a constant in `lib/taxonomy.ts`-adjacent config — an env var adds ceremony for a value that changes never.

## Testing

**Integration-first**: integration tests are the backbone; unit tests only for corner cases where an integration test is overkill. Vitest everywhere.

- **DB:** one `postgres:17` **Testcontainer per test run** (vitest `globalSetup` — the JVM-static container analog). drizzle-kit migrations applied once; every table truncated in `beforeEach`.
- **Bungie:** always mocked with **MSW** (node server) — the WireMock analog. Handlers built per-test from response factories (`groupResponse({...})`, `membersResponse([...])`); tests can assert on intercepted requests.
- **Route handlers** are invoked directly — import the exported `POST`/`GET` from the route file, call it with a constructed `Request`, assert on the `Response` + DB rows. Grey-box, from the contract in.
- **Sessions:** mock `lib/auth`'s `auth()` (vi.mock) to return a seeded session — the `oauth2Login()` post-processor analog. The real OAuth dance is not integration-tested (it's Auth.js's code); our `jwt`/`signIn` callbacks are unit-tested with fake Bungie payloads via MSW.
- **Cron scripts:** import and invoke the sync service the script wraps; assert snapshots/auto-delist against the test DB with MSW simulating 200/404/429/5xx per listing.

```ts
// test/clans-search.test.ts — the shape
it('filters by tag and region', async () => {
  await seedListing({ tags: ['PvE'], region: 'EUROPE', memberCount: 42 });
  await seedListing({ tags: ['Raids'], region: 'AMERICAS' });

  const res = await searchRoute.POST(jsonRequest({ tags: ['PvE'], regions: ['EUROPE'], page: 1, pageSize: 8 }));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total).toBe(1);
  expect(body.items[0].memberCount).toBe(42);
});
```

**What to integration-test:** every endpoint path (success + each error code from api.md), publish/edit/delist transactions, the 410 self-heal, both cron flows (success, Bungie-down, auto-delist on founder change and on 404).
**What to unit-test:** size-tag derivation at boundaries (19/20/50/51 members), the Discord URL regex, ILIKE escaping, Bungie response mapping, zod schema edge cases.

### Manual API testing (`requests/`)

Runnable `.http` files checked into the repo, driven by the **VS Code REST Client** extension — "Send Request" above each entry, response opens in a split pane:

```
requests/
├── clans.http                     # our API: search (per-filter examples), detail, 404 case
├── me.http                        # our API: /api/me, preview, publish, edit (version conflict case), delist
├── bungie.http                    # Bungie API directly — explore real response shapes
└── README.md                      # how to grab the session cookie
.vscode/settings.json              # checked in — REST Client environments:
                                   #   "rest-client.environmentVariables": {
                                   #     "local":       { "baseUrl": "http://localhost:3000" },
                                   #     "local-https": { "baseUrl": "https://127.0.0.1:3000" },
                                   #     "prod":        { "baseUrl": "https://<project>.vercel.app" } }
.env                               # gitignored — SESSION_COOKIE=<value>
```

- Environment switches from the VS Code status bar; requests reference `{{baseUrl}}`. **`local` against plain `next dev` is the default development loop** — poke anonymous endpoints (search, detail) with zero setup, no certs, no cookies. `local-https` (`next dev --experimental-https`) is only needed once you're exercising authenticated endpoints; `prod` is for poking the deployed app.
- Authenticated endpoints send `Cookie: authjs.session-token={{$dotenv SESSION_COOKIE}}` (`__Secure-authjs.session-token` variant for prod) — log in via the browser once, copy the cookie value from DevTools into `.env`. Valid for 30 days.
- `bungie.http` hits Bungie directly and needs only `BUNGIE_API_KEY` in `.env` (no OAuth, no login — these are the public API-key-only endpoints our services and crons use). File-level `@groupId` / `@bungieNetId` variables at the top point at a real clan for exploration:

```http
@bungieBase = https://www.bungie.net/Platform
@groupId = 3960072

### Clan basics — what the S1 cron and preview consume
GET {{bungieBase}}/GroupV2/{{groupId}}/
X-API-Key: {{$dotenv BUNGIE_API_KEY}}

### Member list — what the S2 cron consumes
GET {{bungieBase}}/GroupV2/{{groupId}}/Members/
X-API-Key: {{$dotenv BUNGIE_API_KEY}}

### Groups-for-member — the founder check
GET {{bungieBase}}/GroupV2/User/254/{{bungieNetId}}/0/1/
X-API-Key: {{$dotenv BUNGIE_API_KEY}}
```

(The one OAuth-only Bungie call, `GetMembershipsForCurrentUser`, isn't in this file — it needs a user access token that only exists transiently inside the Auth.js login flow.)
- **HTTPS is not a constraint here.** Bungie's HTTPS requirement applies only to the browser-side OAuth redirect at login; server→Bungie calls behind preview/publish/edit are outbound and don't care where the client request came from. Prod is HTTPS anyway; for local, if REST Client complains about the dev cert, disable certificate validation for localhost in the extension settings.
- Every new endpoint lands with its `.http` entries in the same PR — the collection is documentation-by-example and never goes stale.

### CI

```yaml
# .github/workflows/ci.yml
on:
  pull_request: {}
  push: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest            # Docker preinstalled — Testcontainers works as-is
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
  migrate:                            # applies pending migrations to Neon
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx drizzle-kit migrate
        env: { DATABASE_URL: ${{ secrets.DATABASE_URL }} }
```

- **Branch protection on `main`**: the `test` job is a required check; work goes through PRs. Vercel only deploys prod from `main` → only tested code ships. Preview deploys per branch stay unrestricted.
- **Migration ordering caveat:** Vercel's deploy and the `migrate` job run in parallel on push to `main` — so migrations must be **additive/backward-compatible** with the previous app version (the standing expand-contract rule; at this project's scale it means "don't drop/rename columns in the same PR that stops using them").

## Local development

1. Register a **dev application** at bungie.net/en/Application: redirect `https://127.0.0.1:3000/api/auth/callback/bungie` (Bungie requires HTTPS and rejects the `localhost` hostname — `127.0.0.1` works; see auth.md).
2. DB: `docker run -p 5432:5432 postgres:17` or a Neon dev branch. `npx drizzle-kit migrate`, then `npx tsx scripts/seed.ts` for board data.
3. `.env.local` from `.env.example`.
4. `next dev --experimental-https` — Next generates a locally-trusted cert; open `https://127.0.0.1:3000`. Full OAuth + publish flow works locally against real Bungie; **no tunnel needed** (the OAuth redirect is a browser-side 302 — Bungie's servers never connect to your machine).

## Deployment

- **App:** GitHub repo (public — unlimited Actions minutes) → imported into Vercel once. After that `git push` = deploy: `main` → production, branches → preview URLs. Env vars in the Vercel dashboard, separate preview/prod values.
- **DB:** Neon free tier. Known trade-off: suspends after ~5 min idle → first query after a quiet period pays ~0.5–1s cold start. Acceptable; self-healing (unlike the old Oracle-reclaim problem).
- **Crons:** the two workflow files above; secrets in repo Settings → Actions.
- **Domain:** `<project>.vercel.app` with HTTPS from day one (register the prod Bungie callback against it); custom domain later = one CNAME.

## Observability

- **App logs:** Vercel function logs (dashboard, per-request). `console.error` in the `handled` wrapper is the single funnel for unexpected errors. **Hobby-plan caveat: runtime logs are ephemeral (~hours)** — a live tail for debugging, not an archive; log drains are a paid feature.
- **Cron logs:** the Actions run UI — full stdout per run, retained 90 days, manual re-run button; email on workflow failure (GitHub default) is the v1 alerting. The scripts' end-of-run summary line (`ok / skipped / auto-delisted / failed`) is designed to be read here — including "why did clan X disappear" (auto-delist) investigations.
- **DB:** Neon dashboard (storage, connections, monitoring).
- **Durable error tracking (optional, when the ephemeral Vercel logs start to hurt):** Sentry free tier — one `captureException(e)` in the `handled` wrapper; stack traces persisted + email alerts. Not in v1 by default.
- No file logging, no APM, no metrics export — nothing to rotate because there's no disk.

## What's NOT here

- **Caching layer (Redis, in-memory).** No process to hold memory in; DB is fast enough at v1 scale. Next.js route/page caching can be layered on later if needed.
- **Circuit breaker / semaphore on the request path.** Stateful protection needs a long-lived process; per-call retry + 503 covers the 2–3-call user gestures.
- **API versioning, rate limiting our own endpoints, queues, search infra** — same rationale as before: add when a concrete need appears.
- **`output: 'export'`** — explicitly removed; static export would disable the API routes this design depends on.
