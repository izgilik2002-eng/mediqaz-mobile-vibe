# Deployment

MediQaz deploys the backend API to **Railway**, built from `backend/Dockerfile` and backed by Railway's managed PostgreSQL.

The webapp (admin panel) and the mobile app are not deployed by this document yet. The webapp is a static Vite build and can be added as a second Railway service or any static host; the mobile app ships through Expo/EAS.

## Release Source Preflight

Before any deployment, verify the release source:

```bash
git remote -v
git status --short --branch
```

Deploy only from the intended release branch, after the intended commit is pushed and the local branch is in sync with its upstream. If the worktree has modified, deleted, or untracked files, stop and report that deployment is blocked. Do not run `git reset`, `git checkout --`, `git clean`, or `git stash` to make deployment possible unless that exact destructive action was explicitly requested.

Railway builds from the connected Git branch, not from local files. A dirty checkout cannot reach production by itself, but it can still lead to deploying the wrong branch or erasing another session's work while "cleaning up". The supported failure mode is to stop, not to repair the checkout.

## Service Shape

One Railway project holds two services:

| Service | What it is | Source |
|---|---|---|
| `postgres` | Railway managed PostgreSQL | Railway template |
| `backend` | The API | This repository, `backend/Dockerfile` |

`railway.json` at the repository root configures the backend service:

- **Builder**: `DOCKERFILE`, path `backend/Dockerfile`. The Dockerfile pins the same Bun version as `.bun-version` and runs `prisma generate` at build time. Railpack/Nixpacks auto-detection is not used: it guesses badly on a Bun workspace that must install with `--filter` and generate a Prisma client before the type check.
- **Build context is the repository root.** The backend image needs `bun.lock`, `packages/contracts`, and the root `package.json`, so the service's root directory must stay the repository root, not `backend/`.
- **Pre-deploy command**: `bun run db:deploy`. It applies migrations with `prisma migrate deploy`, seeds the administrator when seed variables are set, and then asserts a login-capable administrator exists. It runs before the new container receives traffic, so a failed migration fails the deploy instead of releasing a broken API.
- **Health check**: `/health/ready`, which checks the database, so a deployment that cannot reach PostgreSQL is never marked healthy.

Adding a second service later (for example the webapp) needs its own config file and that service's "Config file path" set to it; a single root `railway.json` applies to whichever service points at it.

## First Deployment

1. Create a Railway project and add **PostgreSQL** from the template gallery.
2. Add a service from this GitHub repository and select the release branch.
3. In the backend service, confirm **Root Directory** is the repository root and **Config file path** is `railway.json`.
4. Set the environment variables below.
5. Deploy. Watch that the pre-deploy step reports `Database deployment completed with a login-capable administrator.`
6. Generate a public domain for the backend service and run the post-deploy checks.

## Backend Environment

Set these on the backend service. Do not commit any of them.

**Railway provides automatically** — reference the Postgres service rather than pasting a URL, so it survives credential rotation:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
# PORT is injected by Railway; the app already reads it.
```

Use the private `DATABASE_URL`, not `DATABASE_PUBLIC_URL`: the backend and the database sit in the same Railway project, so traffic stays on the private network and does not consume egress.

**Required secrets:**

```bash
NODE_ENV=production
JWT_SECRET=<64+ hex characters>
DEEPGRAM_API_KEY=<Deepgram key with Member rights>
GROQ_API_KEY=<Groq key>
```

Generate the signing secret with `openssl rand -hex 32`. Production rejects anything that is not at least 64 hex characters, so a human-readable passphrase fails at boot rather than silently weakening sessions. `DEEPGRAM_API_KEY` and `GROQ_API_KEY` are required in production: the API refuses to start without them, because a MediQaz deployment where a doctor presses record and nothing happens is worse than a failed deploy.

**Browser auth and CORS:**

```bash
COOKIE_SECURE=true
CORS_ORIGINS=https://admin.example.com
WEBAPP_ORIGIN=https://admin.example.com
TRUST_PROXY=true
TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for
TRUSTED_PROXY_CLIENT_IP_POSITION=last
```

`CORS_ORIGINS` must list every browser origin that calls the API — for MediQaz that is the admin panel. The mobile app is not a browser origin and does not belong here. Production refuses non-HTTPS origins and refuses `COOKIE_SECURE=false`.

`TRUSTED_PROXY_CLIENT_IP_POSITION=last` is deliberate. Railway's edge appends the connecting address to `X-Forwarded-For`, so a client that sends its own `X-Forwarded-For` only pollutes the earlier entries and the rightmost entry is the one the proxy vouched for. Reading `first` would let any caller spoof their address and bypass the auth and consultation rate limits. **Verify this once after the first deploy** (see Validation) — Railway does not document the header contract, and a wrong setting silently degrades rate limiting instead of erroring.

**Administrator seed** — set both together for the first deployment, then remove them:

```bash
ADMIN_SEED_EMAIL=admin@example.com
ADMIN_SEED_PASSWORD=<12-128 characters, not a placeholder>
```

`db:deploy` fails if only one of the pair is set. After the first successful deploy, delete both variables: leaving a known administrator password in the environment is a standing risk, and the seed is idempotent so later deploys without them are harmless.

The seeded administrator is created with `isApproved = false`. That does not block the admin panel, which is gated by role, but it does block that account from recording consultations until it is approved like any other doctor.

**Optional, only when the matching feature is enabled:**

```bash
# Transactional email for password reset
RESEND_API_KEY=
EMAIL_FROM=

# Expo Push (deferred)
EXPO_PUSH_ACCESS_TOKEN=

# S3-compatible storage (deferred)
SPACES_REGION=
SPACES_BUCKET=
SPACES_ENDPOINT=
SPACES_ACCESS_KEY_ID=
SPACES_SECRET_ACCESS_KEY=
```

Consultation tuning has working defaults and only needs overriding under real load:

```bash
CONSULTATION_BODY_LIMIT_BYTES=524288
CONSULTATION_AUDIO_BODY_LIMIT_BYTES=26214400
CONSULTATION_RATE_LIMIT_MAX=30
CONSULTATION_RATE_LIMIT_WINDOW_SECONDS=60
GROQ_MAX_CONCURRENT=1
TRANSCRIPTION_GRANT_TTL_SECONDS=300
```

## Migrations

Migrations run in the pre-deploy command; there is no separate manual step, and no migration is applied from a developer machine against production.

Define schema changes in `backend/prisma/schema.prisma` and generate the SQL through the repository workflow. Never hand-write `migration.sql`. When `prisma migrate dev` cannot reach a database, generate the migration offline from the previous schema:

```bash
cd backend
bunx prisma migrate diff \
  --from-schema <previous-schema.prisma> \
  --to-schema prisma/schema.prisma \
  --script --output prisma/migrations/<timestamp>_<name>/migration.sql
```

`prisma migrate deploy` never rewrites history: it applies pending migrations in order and stops on the first failure, which fails the deploy before the new container takes traffic.

Destructive changes — dropping a column or table that holds consultation data — need a backup first. Railway's Postgres service keeps backups under its **Data** tab.

## Scheduled Maintenance

Session cleanup and notification maintenance are not automatic. Without a schedule, revoked and expired sessions accumulate and `SESSION_RETENTION_DAYS` has no effect.

Add a Railway **Cron** service using the same repository and Dockerfile, with the schedule in UTC and this start command:

```bash
bun src/cron.ts maintenance:process
```

`maintenance:process` deletes expired and revoked sessions past the retention window, removes expired password-reset tokens, and redacts terminal notification payloads. Daily at 03:00 UTC (`0 3 * * *`) is a reasonable default. A cron service must not receive a public domain.

The notification worker (`bun src/worker.ts notifications`) stays unconfigured until Expo Push is enabled.

## Validation

Before deploying, run the local checks for the active surfaces:

```bash
bun run typecheck
bun run test
```

After the first deployment, against the backend's public domain:

```bash
# Liveness and database readiness
curl -fsS https://api.example.com/health/live
curl -fsS https://api.example.com/health/ready

# The seeded administrator can sign in
curl -fsS -X POST https://api.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://admin.example.com' \
  -d '{"email":"admin@example.com","password":"<seed password>"}'
```

Then verify the parts that have never run against real infrastructure:

- **Migrations applied exactly once.** The pre-deploy log lists the pending migrations on a fresh database and reports nothing pending on the next deploy.
- **The proxy header contract.** Make several failed login attempts from one machine and confirm the response becomes `429`, then confirm a different client is unaffected. If every client is rate-limited together, `TRUST_PROXY`/`TRUSTED_PROXY_CLIENT_IP_HEADER` does not match Railway's edge and the limiter is keying on the proxy address.
- **Deepgram.** An approved doctor calling `POST /api/consultations/transcription-token` receives a token and `expiresIn`. A `502` means the key lacks Member rights or the grant response shape changed.
- **Groq.** `POST /api/consultations/appointments/{id}/med-card` with a short Russian transcript returns a med card whose `диагноз.мкб10` is populated. A `502` with "не удалось разобрать медкарту" means the model returned something the parser rejected — check that the model name is still current.

Verify browser auth from an allowed origin only, and confirm cookie-backed auth writes reject a missing or untrusted `Origin`.

## Rollback

Railway keeps previous deployments, and redeploying an earlier one restores the previous image. **Migrations do not roll back with it.** A deployment that added a destructive migration cannot be undone by redeploying the old image — restore the database from a backup first, then redeploy.

This is the practical reason to keep migrations additive: adding a nullable column and backfilling is reversible by redeploying, while dropping a column is not.

## Failure Modes This Setup Guards Against

- A failed migration releasing a broken API — the pre-deploy command fails the deploy first.
- A deployment taking traffic without a database — `/health/ready` checks the connection.
- Production booting without consultation providers — the API refuses to compose without `DEEPGRAM_API_KEY` and `GROQ_API_KEY`.
- A weak or placeholder signing secret — production rejects anything that is not 64+ hex characters.
- Insecure cookies or plaintext origins in production — env validation refuses `COOKIE_SECURE=false` and non-HTTPS `CORS_ORIGINS`.
- An unapproved account consuming paid provider quota — the consultation use cases refuse an account no administrator has approved.

## Current Upstream Documentation

- Railway config as code: https://docs.railway.com/reference/config-as-code
- Railway Dockerfile builds: https://docs.railway.com/guides/dockerfiles
- Railway PostgreSQL: https://docs.railway.com/guides/postgresql
- Railway variables and references: https://docs.railway.com/guides/variables
- Railway cron jobs: https://docs.railway.com/reference/cron-jobs
- Prisma migrate deploy: https://www.prisma.io/docs/orm/prisma-migrate/workflows/production-and-testing
