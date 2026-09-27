# EC2 → Free-tier migration audit (Vercel + Render + Supabase)

**Status:** audit complete; **code changes implemented** (additive, off by default). The step-by-step runbook is [FREE_TIER_DEPLOYMENT.md](FREE_TIER_DEPLOYMENT.md). No EC2 configuration, Docker files, database or production environment was changed.

**Implemented since the audit:**
- The cron endpoint uses an in-process per-scope guard instead of a DB lease (Render Free runs a single instance, so no schema change was needed).
- Everything else follows §18: `vercel.json`, `render.yaml`, CI/backup/cron workflows, `CRON_SECRET`, `TRUST_PROXY`, `DATABASE_SSL_CA`, `no-store`, the test-DB guard, plus `scripts/migrate-to-supabase.sh` and `scripts/supabase-hardening.sql`.
**Audited:** the full repository (`apps/api`, `apps/web`, `packages/*`, `prisma/`, `docker/`, `docker-compose.yml`, `scripts/`, `.env.example`, `package.json` files, docs), plus the platform limits of Render, Supabase and Vercel as documented in September 2026.

Target:

```
GitHub ──► Vercel  (React PWA, static)  ──/api/* rewrite──┐
       └─► Render  (Node/Express API) ◄───────────────────┘
                     ├─► Supabase PostgreSQL
                     ├─► Zoho (READ ONLY)   ├─► GitHub (READ ONLY)
                     ├─► Telegram           ├─► Email
                     └─► AI provider
External cron ──(authenticated POST)──► Render /api/v1/internal/… (scheduled jobs)
```

---

## 0. Headline findings

1. **Nothing in the repository references EC2 or AWS.** Searching for `EC2`, `AWS`, `amazonaws`, `SSM`, `Parameter Store`, `Secrets Manager`, `S3`, `RDS` and `PM2` returns zero hits in code or config. The app is written for *any* host running Docker Compose. Everything EC2-specific lives **on the server itself** (security groups, Elastic IP, Caddy/nginx install, crontab, the Docker volume with the data, the `.env` file) and must be inventoried there (see §2).
2. **The business logic needs no changes.** Timesheets, calendar, sprints, tickets, journal, reports, the assistant, the Tool Gateway, the read-only HTTP client, and the Zoho/GitHub read-only code are portable as they are.
3. **Four platform constraints drive the required changes:**
   - **Render Free sleeps after 15 min without inbound traffic** and may restart at any time. The in-process scheduler (`setInterval`) and Telegram polling therefore cannot be relied on. Scheduled jobs need an authenticated external trigger (§15).
   - **Render Free blocks outbound SMTP on ports 25, 465 and 587.** Email notifications as currently configured (nodemailer, port 587) will fail (§14).
   - **Supabase:** the direct connection is IPv6-only on Free, so use the **Session pooler (IPv4, port 5432)**. TLS verification needs the Supabase CA. The Free plan has **no downloadable backups**, so we must keep our own (§12, §16).
   - **Vercel and Render are different sites.** The session cookie is `SameSite=Lax` and CSRF/CORS assume one origin. Keep them by making Vercel **proxy `/api/*` to Render** (same-origin from the browser's view). The web code needs no change; security headers and cache rules then move into `vercel.json` (§11, §13).

---

## 1. Current architecture

| Layer | Today |
|---|---|
| Runtime | One Docker image (`docker/Dockerfile`, multi-stage, Node 22). `CMD`: `migrate.js`, then `server.js`, as the non-root `node` user. |
| Frontend | React/Vite PWA built into `apps/web/dist` and **served by the API** (`app.ts`, `WEB_DIST_DIR`). Same origin as the API. |
| Backend | Express modular monolith, `/api/v1/*`. Session cookie (`HttpOnly; Secure; SameSite=Lax`), CSRF header `x-pwos-csrf: 1`, CORS limited to `APP_URL`, helmet CSP, in-memory rate limits. |
| Database | `postgres:16-alpine` container, named volume `pgdata`, not published to the host. Prisma 7 client via the `pg` driver adapter. Engine-free SQL migration runner using `pg_advisory_lock`. 35 tables and 2 enums in `public`; **no extensions**. |
| Scheduler | In-process `Scheduler` ticking every `SCHEDULER_TICK_SECONDS` (60). Runs reminders and summaries, **and triggers Zoho/GitHub syncs**. Idempotent through `notifications.idempotencyKey`. |
| Telegram | `TELEGRAM_MODE` = `off` / `polling` (long-poll loop in-process) / `webhook` (secret-header authenticated). |
| Notifications | Telegram, SMTP email (nodemailer), Web Push (VAPID), in-app. Fallback chain; per-attempt history in the DB. |
| Integrations | Zoho OAuth (read scopes only), with tokens AES-256-GCM encrypted using `TOKEN_ENCRYPTION_KEY`. GitHub read-only PAT from env. |
| Edge / TLS | Documented as Caddy or nginx on the host (`docs/MANUAL_SETUP.md` §D). **Not in the repo.** |
| Backups | `scripts/backup.sh` (`docker compose exec db pg_dump`), scheduled by **host crontab** (documented, not in the repo). |
| CI/CD | **None**; there is no `.github/` directory. Deployments are manual (`docker compose up -d --build`). |

## 2. Current EC2 dependencies

**In the repository:** none are EC2-specific. The self-hosting assumptions are in §3–§9.

**On the EC2 instance (not in the repo, so inventory before migrating).** Run these on the box and record the output:

```bash
cat /opt/personal-work-os/.env            # current secrets/values (keep a secure copy)
docker compose ps; docker volume inspect personal-work-os_pgdata
crontab -l; sudo crontab -l               # backup schedule and anything else
systemctl list-units --type=service | grep -Ei 'caddy|nginx|docker|pwos'
ls /etc/caddy /etc/nginx/sites-enabled 2>/dev/null
ls -la /opt/personal-work-os/backups      # existing dumps
curl -s https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo
```

Expected EC2-bound items: Elastic IP and DNS A record, security group (22/80/443), TLS certificates (Caddy or certbot), reverse-proxy config, the `pgdata` volume on EBS, host crontab running `backup.sh`, the `backups/` directory, possibly systemd units, and the Telegram webhook URL.

## 3. Frontend deployment dependencies

| Item | Where | Portability |
|---|---|---|
| API base URL is **relative** (`/api/v1`) | `apps/web/src/lib/api.ts` | Works on Vercel unchanged **if** Vercel rewrites `/api/*` to Render. |
| SPA routing (deep links like `/timesheet`) | served by Express fallback today | Needs a Vercel SPA fallback rewrite (config). |
| CSP and security headers | helmet in the API | Vercel serves the HTML, so the headers must be re-declared in `vercel.json` (config). |
| Service worker `/sw.js` (never caches `/api/`) | `apps/web/public/sw.js` | Portable. Needs `Cache-Control: no-cache` on `sw.js` (config). |
| Monorepo: web imports `@pwos/shared` as a TypeScript workspace source | `packages/shared` | Vercel must install from the **repo root** (npm workspaces). Build: `npm run build --workspace @pwos/web`, output `apps/web/dist`. |
| Dev proxy `localhost:3000` | `apps/web/vite.config.ts` | Dev-only; unaffected. |
| Web Push subscriptions | per browser **origin** | New origin means existing devices must re-enable push (manual). |

## 4. Backend deployment dependencies

| Item | Where | Portability on Render |
|---|---|---|
| `listen(env.PORT)` with no host (binds all interfaces) | `main.ts` | ✅ Render injects `PORT`; the default 3000 is overridden. |
| Build `npm run build` (prisma generate + web + api) | root `package.json` | ✅ Works. Building the web app on Render is unnecessary, so a narrower build command can be used (config). Needs devDependencies at build time: do **not** set `NODE_ENV=production` for the build, or use `npm ci --include=dev`. |
| Start `npm start` (migrate, then server) | root `package.json` | ✅ Works with the Session pooler (advisory lock requires a session, not transaction mode). |
| Serves `apps/web/dist` if present | `app.ts` | Harmless. If the web app is not built on Render, the block is skipped. |
| `trust proxy = 1` | `app.ts` | ⚠️ Behind Vercel → Render's proxy → app, `req.ip` becomes a proxy IP. Rate limits (login in particular) would then be shared by all clients. **Needs a configurable hop count, then testing.** |
| Health check | `/api/v1/health`, `/api/v1/readiness` | ✅ Use `/api/v1/health` as Render's health check path. |
| Graceful shutdown on SIGTERM | `main.ts` | ✅ |
| Node ≥ 22 | `engines` | ✅ Pin the Node version in Render (config). |
| Docker image | `docker/Dockerfile` | ✅ Also deployable on Render's Docker runtime unchanged. That alternative serves web and API from Render alone. |
| API responses carry no `Cache-Control` | all JSON routes | ⚠️ Behind a CDN proxy, add `no-store` for `/api/*` (defence in depth; §11). |

## 5. Database dependencies

- **Connection:** `DATABASE_URL` only (`lib/prisma.ts`, `scripts/migrate.ts`, `prisma.config.ts`). There are no host names in code, and no explicit TLS options (TLS depends entirely on URL parameters).
- **Features used:** plain tables, two enums, indexes and unique constraints. No extensions, no `LISTEN/NOTIFY`, no custom roles. Portable to Supabase Postgres 15 or 17.
- **Session-level features:** `pg_advisory_lock` in the migration runner requires a **direct or session-mode** connection. The app runtime uses interactive transactions and no session state, so it is compatible with either pooler mode. The Session pooler is still recommended (§12).
- **Defaults pointing to localhost:** `.env.example`; test defaults (`TEST_DATABASE_URL` → `localhost/pwos_test`).
- ⚠️ **The test global setup runs `DROP SCHEMA public CASCADE`.** Never point `TEST_DATABASE_URL` at Supabase.

## 6. Scheduler / background-job dependencies

| Job | Current mechanism | Problem on Render Free |
|---|---|---|
| All reminders and summaries (meeting, 17:00, 17:30, 23:00, 08:30, weekly, overdue, sprint-ready) | `Scheduler.start()` → `setInterval` → `runUserJobs()` | The process sleeps after 15 min idle and may restart at any time, so ticks do not happen. |
| Zoho / GitHub auto-sync | called from `runUserJobs()` when due (`sync_states.lastSyncedAt`) | Same. Syncs can also take tens of seconds, too long for short-timeout cron callers. |
| Telegram polling | `startTelegramPolling()` loop | Outbound long-polling does not count as inbound traffic, so the service still sleeps and polling stops. **Use webhook mode.** |
| Backups | host crontab → `scripts/backup.sh` (`docker compose exec`) | There is no host and no Docker on Render or Supabase. |

The good news: `runUserJobs(userId, { notify, now })` is already **clock-injectable and idempotent**. Every job decides what to do from the database, so it can be driven by an external HTTP trigger with no change to job logic. Time-of-day jobs have a 30-minute due window. **Meeting reminders look only `meetingReminderMinutes` (15) ahead**, so the trigger must run at least every ~5 minutes or reminders can be skipped.

## 7. File-storage dependencies

- **No user file uploads exist** anywhere in the app. Exports (CSV/JSON) are generated in memory and streamed.
- Filesystem reads at runtime: built web assets (`apps/web/dist`) and `prisma/migrations` (read at start). Both come from the build, so Render's ephemeral filesystem is fine.
- Filesystem writes: **none** by the app. Logs go to stdout. Only the host-side `backup.sh` writes `backups/` (replaced in §16).
- All durable state (sessions, timer, OAuth tokens and state, notifications, AI usage, Telegram links) is in PostgreSQL. **In memory only:** rate-limit counters, the per-minute AI burst counter, the scheduler's `running` flag, and the Telegram polling offset. All of these are safe to lose on restart.

## 8. Secrets / configuration dependencies

- All configuration comes from environment variables, validated by Zod in `apps/api/src/config/env.ts` (empty string = unset). The app fails fast on invalid values.
- Secrets: `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`/`POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `ZOHO_CLIENT_SECRET`, `GITHUB_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_PASSWORD`, `VAPID_PRIVATE_KEY`.
- Source today: a `.env` file on the EC2 host (via Compose `env_file`). No secret manager is used.
- Target: Render **Environment** settings (encrypted at rest; not in git). Vercel needs **no secrets**, because the SPA has no build-time env vars.

## 9. AWS-specific dependencies

**None.** No AWS SDK, S3, SES, SNS, SQS, RDS, SSM, Secrets Manager, CloudWatch or IAM usage exists in code, dependencies or config. Anything AWS-level (Elastic IP, security groups, EBS snapshots, IAM users for access) is account configuration outside the repo and is simply left in place for rollback.

## 10. Render compatibility issues

| # | Issue | Impact | Resolution | Type |
|---|---|---|---|---|
| R1 | Spins down after 15 min without inbound traffic; about 1 min to spin up | In-process scheduler and polling stop; first request after idle is slow | External authenticated cron endpoint (§15), which also keeps the service warm during active hours | Code + manual config |
| R2 | Outbound SMTP 25/465/587 blocked on Free | Email notifications fail (timeouts) | Use an SMTP provider that accepts **port 2525** (config only, needs testing), **or** add an HTTP-API email provider (code), **or** rely on Telegram, push and in-app | Config / optional code |
| R3 | Ephemeral filesystem; restarts at any time | None for the app (§7) | – | Safe |
| R4 | `trust proxy = 1` behind two proxies | Login rate limit keyed on a proxy IP, which could lock you out or be shared | `TRUST_PROXY` env (hop count), then verify `req.ip` | Small code change + testing |
| R5 | Free instance-hour allowance per workspace | Keeping the service awake 24/7 uses most of it | Trigger every 5 min only during your active hours and hourly overnight (§15). Verify the current allowance on Render's pricing page | Manual config |
| R6 | Build needs devDependencies | Build fails if `NODE_ENV=production` is set at build time | Build command `npm ci --include=dev && …` | Manual config |
| R7 | Telegram polling | Unreliable when asleep | `TELEGRAM_MODE=webhook` pointed at the Render URL | Config |
| R8 | Ollama (`OLLAMA_BASE_URL=localhost`) | No local Ollama on Render; `LOCAL_ONLY` AI mode is unusable | Use Gemini or OpenRouter, or AI off. Do not expose a home Ollama publicly | Config (functional trade-off) |
| R9 | Long requests (assistant with several tool rounds, manual "Sync now") | Might exceed a proxy timeout when routed through Vercel | Test. If needed, call sync through the cron endpoint | Testing |

## 11. Vercel compatibility issues

| # | Issue | Resolution | Type |
|---|---|---|---|
| V1 | Cross-site cookies: the SPA on `*.vercel.app` calling `*.onrender.com` would not receive the `SameSite=Lax` session cookie, and CORS/CSRF assume one origin | **`vercel.json` rewrite `/api/:path*` → `https://<render-service>.onrender.com/api/:path*`**. The browser sees one origin, the cookie is host-only on the Vercel domain, and CSRF, CORS and SameSite stay **as strict as today**. No web code change. Do *not* switch to `SameSite=None` or bearer tokens in localStorage. | New config file |
| V2 | SPA deep links | Rewrite everything that is not `/api/…` and not a static file to `/index.html` | Config |
| V3 | Security headers (CSP, frame-ancestors, nosniff, referrer policy) are currently sent by helmet on API responses only | Replicate the helmet CSP in `vercel.json` `headers` for all routes | Config |
| V4 | Vercel now caches external-rewrite responses when upstream cache headers allow it | API responses contain personal data: add `Cache-Control: no-store` in the API for `/api/*` **and** in `vercel.json`. Verify with the `x-vercel-cache` header | Small code change + config + testing |
| V5 | Monorepo workspace build | Root directory = repo root; Install `npm ci`; Build `npm run build --workspace @pwos/web`; Output `apps/web/dist` | Manual config |
| V6 | Preview deployments proxy to the **production** API | Enable Vercel Deployment Protection for previews, or point previews at nothing | Manual config |
| V7 | `sw.js` caching | Header `Cache-Control: no-cache` for `/sw.js` | Config |

## 12. Supabase compatibility issues

| # | Issue | Resolution | Type |
|---|---|---|---|
| S1 | The direct connection (`db.<ref>.supabase.co`) is IPv6-only on Free | Use the **Shared pooler, Session mode**: `aws-<region>.pooler.supabase.com:5432`, user `postgres.<ref>` (IPv4) | Config |
| S2 | Transaction mode (6543) breaks session advisory locks (migration runner) | Use Session mode (5432) for both runtime and migrations | Config |
| S3 | TLS: no SSL options in code; URL `sslmode=require` in recent `pg` versions means full certificate verification, and Supabase certificates chain to the **Supabase CA** | Add optional `DATABASE_SSL_CA` (PEM from the Supabase dashboard) to `lib/prisma.ts` and `scripts/migrate.ts`. **Do not** use `rejectUnauthorized:false` / `sslmode=no-verify` | Small code change + testing |
| S4 | Data API exposure: projects that grant `anon`/`authenticated` on `public` by default expose new tables through PostgREST | Create the project with automatic exposure **off**. After restore, `REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon, authenticated;` and enable RLS on all tables (no policies = deny for API roles; the app connects as `postgres` and is unaffected). Never publish the anon key. Optionally remove `public` from exposed schemas | Manual config + testing |
| S5 | Free projects pause after about 7 days of low activity | The 5-minute scheduler trigger touches the DB constantly. Still monitor Supabase's pause warning emails | Monitoring |
| S6 | **No downloadable backups on Free** | Our own scheduled `pg_dump`, encrypted, stored off-platform (§16) | New workflow + manual config |
| S7 | Roles and ownership differ (`pwos` vs `postgres`) | Restore with `--no-owner --no-privileges` | Data migration |
| S8 | Region latency (several queries per request) | Put Render and Supabase in the **same region** | Manual config |
| S9 | Postgres version (16 → 15/17) | `pg_dump` from the client version ≥ both servers; plain SQL format | Data migration |
| S10 | Free database size cap (500 MB at time of writing) | This app's data is tiny; check `pg_database_size` first | Check |

## 13. Authentication / OAuth callback changes

- **Sessions:** unchanged mechanism. The cookie will be set on the Vercel domain (through the proxy). Existing sessions in the DB migrate, but browsers hold cookies for the old domain, so **you sign in once again**. `COOKIE_SECURE` stays unset (secure) because everything is HTTPS.
- **CSRF / CORS:** unchanged thanks to the same-origin proxy. `APP_URL` = the Vercel URL, since it is used for CORS, OAuth redirects and links inside notifications.
- **Zoho OAuth:** `/integrations/zoho/connect` sets a short-lived **state cookie on the domain that served it**, and the callback needs both that cookie and the session cookie. Therefore:
  - `ZOHO_REDIRECT_URI = https://<vercel-domain>/api/v1/integrations/zoho/callback` (through Vercel, **not** the Render URL).
  - **Add** this URI in the Zoho API console **alongside** the EC2 one (Zoho allows several), so rollback stays possible.
  - Existing Zoho tokens keep working after the data migration **only if `TOKEN_ENCRYPTION_KEY` is identical**. Otherwise you must reconnect Zoho.
- **Telegram webhook:** authenticated by the secret header, with no cookies involved, so it can target Render directly: `https://<render-service>.onrender.com/api/v1/telegram/webhook`. Re-register it with `setWebhook`. Links (`telegram_links`) migrate with the data.
- **GitHub:** a PAT with no callbacks. No change.
- **Admin bootstrap:** it only runs when no users exist. After the data restore it does nothing, so `ADMIN_PASSWORD` need not be set on Render.

## 14. Notification architecture changes

| Channel | On Render Free | Action |
|---|---|---|
| In-app | ✅ | None |
| Telegram | ✅ (webhook) | `TELEGRAM_MODE=webhook`, new webhook URL. Stop EC2 from polling or receiving at cutover |
| Web Push | ✅ (HTTPS API egress) | Keep the **same VAPID keys**; re-enable push on each device from the new origin |
| Email (SMTP 587/465) | ❌ blocked | Port 2525 SMTP provider (config), or an HTTP-API provider (code), or disable email and use Telegram as primary with in-app fallback |

The engine itself (idempotency keys, fallback chain, delivery history) needs no change. **Critical:** idempotency is per database. If both EC2 and Render run schedulers during the transition, **duplicate reminders** are sent. Disable the EC2 scheduler (`SCHEDULER_ENABLED=false`) at cutover.

## 15. Cron / scheduler migration plan (design; not implemented)

1. **New authenticated endpoint** (small new module, mounted before the CSRF guard like the Telegram webhook):
   `POST /api/v1/internal/cron/tick?scope=notifications|sync|all`, `Authorization: Bearer <CRON_SECRET>` (≥ 32 random bytes, constant-time compare), rate-limited, never cookie-authenticated. It calls the **existing** `runUserJobs()` with `now = new Date()`, with no change to job logic.
2. **Split fast from slow:** `scope=notifications` returns within a few seconds. `scope=sync` runs Zoho/GitHub syncs (these can take longer) and can be triggered less often. This keeps the call within short cron-caller timeouts.
3. **Concurrency:** notifications are already idempotent in the DB. For syncs, add a DB lease (e.g. a `sync_states` row with a lease expiry) so overlapping triggers cannot run the same sync twice. This replaces the in-memory `running` flag.
4. **Disable the in-process timer on Render:** `SCHEDULER_ENABLED=false`. The flag already exists; the in-process scheduler stays intact for Docker/EC2.
5. **Triggers** (all free):
   - Primary: an external cron service with per-minute granularity (e.g. cron-job.org) calling Render directly every **5 min** during your active hours (e.g. 07:00–23:59 local) and hourly overnight. This covers the 15-minute meeting-reminder window, the 30-minute time-of-day windows, the 23:00 summary, and Supabase activity.
   - Backup: a GitHub Actions `schedule` workflow calling the same endpoint (best-effort timing, so not the primary).
   - Store `CRON_SECRET` in the cron service and in GitHub Actions secrets.
6. **Cold starts:** the first call after sleep can take about a minute. The caller must allow for that; the due windows tolerate it.
7. **Backups** move to a scheduled GitHub Actions workflow (§16).

## 16. Database migration plan

**What moves:** the whole `public` schema: all 35 tables including `_prisma_migrations`. That covers users, sessions, settings, timesheets, entries, timer, leave/holidays, journal, projects/sprints/work items (+snapshots, local notes), calendar events (+local), GitHub repos/activities, suggestions, OAuth tokens (encrypted), integration and sync state, notifications, deliveries, preferences, push subscriptions, Telegram links and link tokens, conversations, messages, action logs, AI usage and audit logs.

Steps:
1. **Rehearsal (no downtime):** on EC2, dump:
   ```bash
   docker compose exec -T db pg_dump -U pwos -d pwos --no-owner --no-privileges --format=plain > pwos-rehearsal.sql
   ```
   Restore into a **throwaway** Supabase project over the Session pooler with `psql "…?sslmode=verify-full&sslrootcert=supabase-ca.crt" -v ON_ERROR_STOP=1 -f pwos-rehearsal.sql`. Point a temporary Render service at it and run the test checklist.
2. **Row-count baseline:** record `SELECT relname, n_live_tup …` or an exact `count(*)` per table on EC2.
3. **Cutover window** (write freeze; about 10–20 minutes for a DB this size):
   1. Take a final backup on EC2.
   2. Stop the EC2 app container: `docker compose stop app`. Keep `db` running.
   3. Final `pg_dump`, then restore into the production Supabase project (empty schema).
   4. Compare row counts.
   5. Apply the Supabase hardening from S4 (revoke API grants, enable RLS).
   6. Deploy/start Render with `SCHEDULER_ENABLED=false`, then enable the cron triggers.
   7. The migration runner sees all migrations applied (checksums match), so it applies nothing.
4. **Ongoing backups:** a nightly GitHub Actions workflow runs `pg_dump` (client version ≥ server) over the Session pooler, **encrypts** the dump (age/gpg with a key held only in secrets), and stores it off-platform with limited retention. Test a restore monthly. Keep `TOKEN_ENCRYPTION_KEY` backed up separately.

## 17. Environment-variable migration plan

| Variable | EC2 (today) | Render (target) | Notes |
|---|---|---|---|
| `DATABASE_URL` | Compose builds it (`db:5432`) | Supabase **Session pooler** URL (`…pooler.supabase.com:5432/postgres`, user `postgres.<ref>`, TLS params) | Changes |
| `POSTGRES_PASSWORD`, `HOST_PORT` | used | not used | Compose-only |
| `APP_URL` | EC2 domain | Vercel URL (e.g. `https://pwos.vercel.app` or custom domain) | Changes |
| `ZOHO_REDIRECT_URI` | EC2 domain | `https://<vercel-domain>/api/v1/integrations/zoho/callback` | Changes, plus the Zoho console entry |
| `TOKEN_ENCRYPTION_KEY` | set | **identical value** | Must not change |
| `VAPID_*` | set | **identical values** | Keep |
| `TELEGRAM_MODE` | polling or webhook | `webhook` | Changes if polling |
| `TELEGRAM_WEBHOOK_SECRET` | maybe | required | New if absent |
| `SCHEDULER_ENABLED` | `true` | `false` (external trigger) | Changes |
| `CRON_SECRET` | – | new random secret | **New** (needs code) |
| `TRUST_PROXY` | – | proxy hop count (verify) | **New** (needs code) |
| `DATABASE_SSL_CA` | – | Supabase CA PEM | **New** (needs code) |
| `SMTP_PORT` / `SMTP_*` | 587 | 2525-capable provider, or unset | Changes |
| `AI_PROVIDER`, `OLLAMA_BASE_URL` | maybe ollama | gemini / openrouter / none | Changes if Ollama |
| `NODE_ENV` | production | production (runtime only) | Build must still install devDependencies |
| `PORT` | 3000 | set by Render | Do not set manually |
| `WEB_DIST_DIR`, `MIGRATIONS_DIR` | Docker paths | unset (defaults work from the repo root) | – |
| `ADMIN_*` | first-start only | not needed after the data restore | Optional |
| All others (`ZOHO_*`, `GITHUB_*`, `GEMINI_*`, `OPENROUTER_*`, `RATE_LIMIT_*`, `SESSION_TTL_DAYS`, `LOG_LEVEL`, `COOKIE_SECURE` unset) | – | same values | Copy |
| Vercel project | – | **no env vars** | The rewrite target is hard-coded in `vercel.json` (not a secret) |

## 18. Files that need modification (proposed; nothing changed yet)

| File | Change | Why |
|---|---|---|
| **new** `vercel.json` | `/api/*` rewrite to Render, SPA fallback, security headers (CSP equal to helmet's), `no-store` for `/api/*`, `no-cache` for `/sw.js` | V1–V4, V7 |
| **new** `render.yaml` (optional Blueprint) | Service definition: build/start commands, health path, env var names (no values) | Reproducible Render setup |
| **new** `apps/api/src/modules/scheduler/cron.routes.ts` | Authenticated tick endpoint (§15) | R1 |
| `apps/api/src/app.ts` | Mount the cron route before `csrfGuard`; `Cache-Control: no-store` on `/api`; `trust proxy` from env | R1, V4, R4 |
| `apps/api/src/config/env.ts` | Add `CRON_SECRET`, `TRUST_PROXY`, `DATABASE_SSL_CA` (all optional; defaults keep today's behaviour) | R1, R4, S3 |
| `apps/api/src/lib/prisma.ts`, `apps/api/scripts/migrate.ts` | Optional CA-verified TLS | S3 |
| `apps/api/src/modules/scheduler/scheduler.ts` / `sync` | DB lease for sync runs | Overlapping external triggers |
| **new** `.github/workflows/cron-backup-trigger.yml`, `db-backup.yml`, optional `ci.yml` | Backup trigger, encrypted nightly dumps, CI (lint, typecheck, tests with a Postgres service) | §15, §16 |
| `apps/api/test/*` | Tests for cron auth (401/403, constant time, scopes) and TLS config; guard so `global-setup.ts` refuses non-local DB hosts | Safety |
| `.env.example`, `README.md`, `docs/MANUAL_SETUP.md`, `docs/deployment.md` | Add a "Free tier (Vercel + Render + Supabase)" path **alongside** the Docker/EC2 path | Docs |
| *(optional)* `apps/api/src/modules/notifications/providers/` | HTTP-API email provider | Only if port 2525 SMTP is not an option (R2) |

## 19. Files that do NOT need modification

- All business modules: `timesheets`, `timer`, `journal`, `calendar`, `work`, `suggestions`, `reports`, `dashboard`, `timeline`, `search`, `exports`, `settings`, `auth`, `audit`, `health`.
- **Read-only architecture:** `integrations/http/read-only-http-client.ts`, `integrations/zoho/*`, `integrations/github/*`, `integrations/providers.ts`, `integrations/oauth/zoho-oauth.ts`, `sync/*` (apart from the optional lease), and `test/external-read-only.test.ts`.
- **Assistant and AI:** `assistant/*` (Tool Gateway, handlers, action store, confirmation state machine, deterministic parser), `ai/*`, `packages/ai-contracts`.
- Notifications engine, templates and the Telegram, Web Push and in-app providers. Telegram routes and service (the webhook mode already exists).
- `scheduler/jobs.ts` (job logic reused as-is).
- `prisma/schema.prisma` and `prisma/migrations/*` (no schema change).
- The entire web app (`apps/web/src/**`, `public/**`), since the API path is relative. `packages/shared`.
- `docker/Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/backup.sh`, `scripts/restore.sh`: **kept unchanged for EC2 and rollback.**

## 20. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missed or late reminders (cold start, cron delays) | Medium | Medium | 5-min primary trigger + backup trigger; due windows; notification history |
| Duplicate reminders during transition (two schedulers) | High if forgotten | Low–Medium | `SCHEDULER_ENABLED=false` on EC2 at cutover |
| Email silently failing (SMTP block) | Certain if unchanged | Medium | Port 2525 provider, test email before cutover, Telegram fallback |
| Supabase tables exposed via the Data API | Medium (project settings) | **High** | Revoke grants, enable RLS, don't publish keys; verify with a REST call using the anon key (expect permission denied) |
| TLS misconfiguration, or a temptation to disable verification | Medium | High | CA-verified TLS; never `no-verify` |
| Wrong `TOKEN_ENCRYPTION_KEY` | Low | Medium | Copy verbatim; test a Zoho sync before decommissioning |
| Edge caching of personal API responses | Low–Medium | **High** | `no-store` in API and `vercel.json`; verify headers |
| Rate limiter keyed on proxy IP (login lockout) | Medium | Low–Medium | `TRUST_PROXY` hop config; test |
| Free-tier limits change or the project pauses | Medium | Medium | Monitor; own backups; documented rollback |
| No platform backups on Supabase Free | Certain | High | Own encrypted nightly dumps + restore tests |
| Previews acting on production data | Medium | Medium | Deployment Protection |
| Long assistant or sync requests timing out via the proxy | Low–Medium | Low | Test; syncs via cron scope |
| Running tests against Supabase wipes data | Low | **Critical** | Host guard in `global-setup.ts`; never set `TEST_DATABASE_URL` remotely |

## 21. Rollback strategy

Keep EC2 **fully intact and stopped rather than deleted** for at least 2–4 weeks: instance, volume, `.env`, crontab, proxy, Elastic IP, and the Zoho redirect URI entry.

1. **Before any writes on Supabase (during validation):** point DNS or users back to the EC2 URL, restart the EC2 app, re-register the Telegram webhook to EC2 (or restart polling), and set `SCHEDULER_ENABLED=true` on EC2. No data loss.
2. **After writes on Supabase:**
   1. Freeze Render: suspend the service and pause the cron triggers.
   2. Dump from Supabase with `pg_dump --no-owner --no-privileges` and restore into the EC2 container: `scripts/restore.sh` semantics, `--clean --if-exists`, or drop and recreate the schema first.
   3. Start the EC2 app with the scheduler enabled and re-point the Telegram webhook.
   4. Sign in again on the old domain.
   - Because `TOKEN_ENCRYPTION_KEY` and the VAPID keys are identical, Zoho tokens and push keep working.
3. Because the application code is the same on both sides (only additive, flag-guarded changes), rollback requires **no code revert**. `SCHEDULER_ENABLED=true` and an unset `CRON_SECRET` restore today's behaviour exactly.

## 22. Recommended migration order

1. **Inventory EC2** (§2) and take a verified backup, stored off the instance.
2. **Code (additive, flag-guarded, tested; EC2 behaviour unchanged by default):**
   - cron endpoint + sync lease
   - `no-store` header
   - `TRUST_PROXY`
   - `DATABASE_SSL_CA`
   - test DB guard
   - `vercel.json`
   - optional `render.yaml` and workflows
   - Deploy to EC2 first to prove nothing regressed.
3. Push to **GitHub** (private repo). Add CI.
4. Create the **Supabase** project (same region as the Render region; automatic Data API exposure off). Download the CA certificate.
5. **Rehearsal:** restore a dump into Supabase, deploy a Render service against it, and a Vercel preview proxied to it. Run the testing checklist.
6. Configure the **email** path (port 2525 provider) and **Telegram webhook** on the rehearsal stack; test each channel.
7. Configure the **cron triggers** against the rehearsal stack; watch the notification history for a full day.
8. Register the new **Zoho redirect URI** (keep the old one).
9. **Cutover window** (§16.3): freeze EC2, final dump and restore, harden Supabase, switch envs, start Render with cron, set the Telegram webhook, sign in, reconnect push.
10. **Observe for 1–2 weeks:** reminders, syncs, backups, Supabase pause emails.
11. Decommission EC2 only after a successful restore test from the new backups.

---

## Answers A–O

**A. What can move to Vercel without code changes?** The entire React PWA (`apps/web`): relative API paths, service worker and manifest. A **new `vercel.json`** (config, not app code) is required for the `/api` proxy, SPA fallback, security headers and cache rules.

**B. What can move to Render without code changes?** The whole API: routes, services, integrations, Tool Gateway, assistant, notifications engine and migrations. It works with `npm start` (or the unchanged Dockerfile), the Session pooler URL, `TELEGRAM_MODE=webhook`, and `SCHEDULER_ENABLED=false` **only if** scheduled jobs are temporarily triggered some other way. Without the cron endpoint, reminders and auto-sync only run while the service happens to be awake.

**C. What needs modification?** An authenticated cron endpoint plus a sync lease; `Cache-Control: no-store` on API responses; a configurable `trust proxy`; CA-verified TLS for the DB; new `vercel.json`, optionally `render.yaml` and GitHub workflows (backup and cron fallback); tests and docs. Optionally an HTTP email provider. No business logic changes.

**D. What is currently EC2-specific?** Nothing in the repository. On the server: the host, Elastic IP and DNS, security group, Caddy/nginx and TLS certificates, the Docker `pgdata` volume on EBS, the host crontab for `backup.sh`, local `backups/`, the `.env` file, and the Telegram webhook URL or polling process.

**E. What is currently AWS-specific?** Nothing in code or config. Only account-level infrastructure (EC2, EBS, EIP, security groups) outside the repo.

**F. What moves from EC2 PostgreSQL to Supabase?** The complete `public` schema, including all 35 tables and `_prisma_migrations`, via `pg_dump --no-owner --no-privileges` → `psql` over the Session pooler.

**G. What happens to existing data?** It is copied, not transformed: no schema changes, row counts verified. Encrypted Zoho tokens remain valid with the same `TOKEN_ENCRYPTION_KEY`. Telegram links, preferences, notification history, assistant history and audit logs are preserved. Browser sessions do not carry over (new domain), so you sign in once. Push must be re-enabled per device. The EC2 copy remains untouched for rollback.

**H. What happens to cron jobs?** The host crontab (backups) is replaced by a GitHub Actions nightly encrypted `pg_dump`. The in-process scheduler is disabled on Render and driven by an external authenticated trigger every 5 minutes (active hours) and hourly overnight, with GitHub Actions as a backup trigger.

**I. What happens to notification jobs?** The same job code (`runUserJobs`) and the same idempotency, now invoked through the cron endpoint. Telegram moves to webhook mode, push keeps its VAPID keys (devices re-subscribe), and email needs a port-2525 SMTP provider or an HTTP provider. Only one scheduler may be active across EC2 and Render at any time.

**J. What happens to file uploads?** There are none, so nothing changes. The app writes nothing to disk; Render's ephemeral filesystem is fine.

**K. What happens to OAuth callback URLs?** Zoho: new redirect `https://<vercel-domain>/api/v1/integrations/zoho/callback`, added in the Zoho console *alongside* the old one; `ZOHO_REDIRECT_URI` is updated on Render. It must go through Vercel because the state and session cookies live there. Telegram: `setWebhook` to the Render URL. GitHub: none.

**L. What environment variables change?** Changed: `DATABASE_URL`, `APP_URL`, `ZOHO_REDIRECT_URI`, `SCHEDULER_ENABLED`, `TELEGRAM_MODE`/`TELEGRAM_WEBHOOK_SECRET`, `SMTP_*`, possibly `AI_PROVIDER`. New: `CRON_SECRET`, `TRUST_PROXY`, `DATABASE_SSL_CA`. Unchanged and must match: `TOKEN_ENCRYPTION_KEY`, `VAPID_*`. Dropped: `POSTGRES_PASSWORD`, `HOST_PORT`, `WEB_DIST_DIR`, `MIGRATIONS_DIR`, `PORT`. See §17.

**M. What is the safest migration sequence?** Inventory and back up EC2, then additive code changes deployed to EC2 first, then a rehearsal on a throwaway Supabase + Render + Vercel preview, then channel and cron tests, then a short write-frozen cutover, then an observation period, then decommissioning (§22).

**N. What can cause downtime?** The cutover write freeze (about 10–20 min); Render cold starts (~1 min) whenever the service has slept; Supabase pausing if inactive; TLS or pooler misconfiguration; a DNS or URL switch; a Telegram webhook re-registration gap. The Zoho redirect mismatch only affects re-connecting.

**O. How do we roll back to EC2?** EC2 stays intact but stopped. Before new writes: restart EC2, re-point Telegram and DNS, enable its scheduler. After new writes: freeze Render, dump Supabase, restore to EC2, then the same steps. The same encryption and VAPID keys mean no reconnects; flag-guarded code means no code revert (§21).

---

## Migration checklist

**Safe without changes**
- [ ] safe without changes: all business modules (timesheets, timer, calendar, meetings, sprints, tickets, journal, reports, search, exports)
- [ ] safe without changes: Zoho/GitHub read-only architecture, read-only HTTP client, OAuth token handling
- [ ] safe without changes: Tool Gateway, assistant, AI providers (Gemini/OpenRouter), audit/history
- [ ] safe without changes: notification engine, idempotency, Telegram webhook mode, Web Push, in-app
- [ ] safe without changes: Prisma schema and migrations, migration runner (with the Session pooler)
- [ ] safe without changes: web app source, service worker, relative API paths
- [ ] safe without changes: Dockerfile, docker-compose, backup/restore scripts (kept for EC2 and rollback)

**Requires changes**
- [ ] requires changes: authenticated cron endpoint (`CRON_SECRET`) + DB lease for syncs
- [ ] requires changes: `Cache-Control: no-store` on `/api/*`
- [ ] requires changes: configurable `trust proxy` (`TRUST_PROXY`)
- [ ] requires changes: CA-verified DB TLS (`DATABASE_SSL_CA`) in `lib/prisma.ts` and `scripts/migrate.ts`
- [ ] requires changes: new `vercel.json` (rewrite, SPA fallback, security headers, cache rules)
- [ ] requires changes: GitHub Actions for encrypted DB backups (+ backup cron trigger, optional CI)
- [ ] requires changes: test-DB host guard; tests for the new endpoint; docs for the free-tier path
- [ ] requires changes (optional): HTTP-API email provider if port 2525 SMTP is unavailable

**Requires manual configuration**
- [ ] requires manual configuration: inventory EC2 (`.env`, crontab, proxy, webhook, volume)
- [ ] requires manual configuration: GitHub private repository
- [ ] requires manual configuration: Supabase project (region, Data API exposure off, CA certificate, Session pooler URL)
- [ ] requires manual configuration: Render web service (region, Node 22, build/start commands, health path, env vars)
- [ ] requires manual configuration: Vercel project (repo root, workspace build, output dir, Deployment Protection)
- [ ] requires manual configuration: Zoho console (add the new redirect URI, keep the old)
- [ ] requires manual configuration: Telegram `setWebhook` to Render with the secret
- [ ] requires manual configuration: SMTP provider on port 2525 (or email disabled)
- [ ] requires manual configuration: external cron service + GitHub Actions secrets (`CRON_SECRET`, DB URL, encryption key)
- [ ] requires manual configuration: `SCHEDULER_ENABLED=false` on EC2 at cutover
- [ ] requires manual configuration: re-enable browser push on each device

**Requires data migration**
- [ ] requires data migration: rehearsal dump → throwaway Supabase
- [ ] requires data migration: final `pg_dump --no-owner --no-privileges` → Supabase during the write freeze
- [ ] requires data migration: row-count verification per table
- [ ] requires data migration: post-restore hardening (revoke `anon`/`authenticated`, enable RLS)

**Requires testing**
- [ ] requires testing: sign-in, session persistence and CSRF through the Vercel proxy
- [ ] requires testing: no edge caching of `/api` responses (`x-vercel-cache`, `Cache-Control`)
- [ ] requires testing: rate limits see the real client IP
- [ ] requires testing: DB TLS verification succeeds via the Session pooler; migrations report "up to date"
- [ ] requires testing: Supabase Data API returns permission denied for app tables with the anon key
- [ ] requires testing: cron endpoint rejects missing or wrong secrets; reminders fire on schedule for a full day, with no duplicates
- [ ] requires testing: Zoho connect and sync (tokens decrypt), GitHub sync, sync failure notifications
- [ ] requires testing: Telegram webhook (`/today`, confirm and cancel buttons), email test, push test
- [ ] requires testing: assistant (read, confirm-once write, Zoho refusal), long requests through the proxy
- [ ] requires testing: backup workflow produces an encrypted dump, and a restore from it succeeds
- [ ] requires testing: rollback drill (Supabase dump → EC2 restore) at least once before decommissioning
- [ ] requires testing: full automated suite (`npm run check`) against a **local** test database
