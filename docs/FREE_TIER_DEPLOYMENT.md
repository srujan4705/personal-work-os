# Free-tier deployment: Vercel + Render + Supabase

Deploys Personal Work OS at zero cost:

```
Browser ─► Vercel (React PWA)  ──/api/* proxy──►  Render Free (Express API) ──► Supabase Postgres (Session pooler, verified TLS)
                                                        ▲        ├─► Zoho / GitHub (read-only)
External cron (every 5 min) ── Bearer CRON_SECRET ──────┘        └─► Telegram (webhook) · Email (SMTP 2525) · Push · AI
GitHub Actions: CI · hourly backup trigger · nightly encrypted DB backup
```

The Docker/EC2 setup (`docker-compose.yml`, `docker/Dockerfile`, `docs/MANUAL_SETUP.md`) is **unchanged and still supported**; it is your rollback path. Background: `docs/EC2_TO_FREE_TIER_MIGRATION.md`.

**What the code already handles** (all off by default, so EC2 behaves exactly as before):
- `POST /api/v1/internal/cron/tick?scope=all|notifications|sync` runs scheduled jobs from an external trigger. It is authenticated by `Authorization: Bearer <CRON_SECRET>` and disabled when `CRON_SECRET` is empty.
- `DATABASE_SSL_CA` enforces verified TLS to Postgres (Supabase CA).
- `TRUST_PROXY` sets the proxy hop count, so rate limits see your real IP.
- Every `/api` response is marked `Cache-Control: no-store`, so personal data is never cached by Vercel's CDN.
- `vercel.json`, `render.yaml`, `.github/workflows/*`, `scripts/migrate-to-supabase.sh`, `scripts/supabase-hardening.sql`.

Follow the steps **in order**. Steps 1–9 build a full rehearsal copy while EC2 keeps running; step 10 is the short cutover.

---

## 0. Before you start (on EC2)

- **Purpose:** have a verified backup and a record of today's configuration before touching anything.
- **Where:** SSH into the EC2 host, in the project directory.
- **What to configure:** run `./scripts/backup.sh`, then copy the newest `backups/*.sql.gz` **and** `.env` to your own machine. Also record `crontab -l` and `curl -s https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.
- **Values to copy:** from the EC2 `.env`: `TOKEN_ENCRYPTION_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and all Zoho, GitHub, AI, Telegram and SMTP values.
- **Where to paste:** a password manager (you will paste them into Render in step 3).
- **Security warning:** `.env` and the dump contain all secrets and data. Never commit them; delete temporary copies afterwards.
- **How to verify:** `gunzip -t` on the backup succeeds, and you can read every value above.

## 1. GitHub repository

- **Purpose:** Vercel and Render deploy from GitHub; Actions run CI, backups and the backup cron trigger.
- **Where:** github.com → **New repository** → **Private**.
- **What to configure:** push the project: `git init && git add -A && git commit -m "Personal Work OS" && git branch -M main && git remote add origin <url> && git push -u origin main`.
- **Values to copy:** the repository URL.
- **Where to paste:** Vercel and Render when importing (steps 3–4).
- **Security warning:** make sure `.env`, `backups/` and certificates are **not** committed (`git status` must not list them; `.gitignore` covers `.env` and `backups`).
- **How to verify:** the **Actions** tab shows the **CI** workflow passing (lint, typecheck, tests, build).

## 2. Supabase project

### 2a. Create the project
- **Purpose:** the production database.
- **Where:** supabase.com → **New project**.
- **What to configure:**
  - Region: close to you. Remember it; Render must use the matching region (step 3).
  - Database password: generate a long one.
  - **Uncheck automatic exposure of new tables to the Data API** (labelled "Automatically expose new tables" or "Default privileges for new entities"). The app does not use Supabase's Data API.
- **Values to copy:** database password, project ref.
- **Where to paste:** password manager.
- **Security warning:** never publish the project's `anon` or `service_role` keys. The app doesn't need them.
- **How to verify:** the project dashboard shows **Healthy**.

### 2b. Connection string and CA certificate
- **Purpose:** connect over IPv4 (the Free plan's direct connection is IPv6-only) with **verified** TLS.
- **Where:** project → **Connect** → **Session pooler**. Then **Project Settings → Database → SSL Configuration** → **Download certificate**, and turn on **Enforce SSL on incoming connections**.
- **What to configure:** use the **Session pooler** URL (host `aws-…pooler.supabase.com`, **port 5432**, user `postgres.<ref>`). Do **not** use the transaction pooler (6543): the migration runner needs session-level locks.
- **Values to copy:**
  - `DATABASE_URL` = the session pooler URI, with your password inserted and URL-encoded if it contains special characters.
  - `DATABASE_SSL_CA` = the certificate encoded as one line: `base64 -w0 prod-ca-2021.crt` (Linux) or `base64 -i prod-ca-2021.crt` (macOS).
- **Where to paste:** Render (step 3), and GitHub secrets for backups (step 8).
- **Security warning:** never replace verification with `sslmode=no-verify`. Keep the CA file for the migration script (step 10).
- **How to verify:** `PGSSLMODE=verify-full PGSSLROOTCERT=prod-ca-2021.crt psql "<DATABASE_URL>" -c "select 1"` returns `1`.

## 3. Render web service (API)

- **Purpose:** runs the API.
- **Where:** render.com → **New → Blueprint** → select the repository (uses `render.yaml`). Before applying, set `region:` in `render.yaml` to match Supabase (`virginia`, `ohio`, `oregon`, `frankfurt` or `singapore`) and push.
- **What to configure:** fill every variable marked "sync: false":

  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | Supabase Session pooler URL (step 2b). **For the rehearsal, use a *separate throwaway* Supabase project.** |
  | `DATABASE_SSL_CA` | base64 CA (step 2b) |
  | `APP_URL` | leave `https://example.com` for now; set in step 5 |
  | `TOKEN_ENCRYPTION_KEY` | **exactly the EC2 value** (otherwise Zoho must be reconnected) |
  | `VAPID_*` | **exactly the EC2 values** |
  | `ZOHO_*`, `GITHUB_TOKEN`, `AI_PROVIDER`, `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | EC2 values (Ollama is not reachable from Render: use `gemini`, `openrouter` or `none`) |
  | `ZOHO_REDIRECT_URI` | set in step 5 |
  | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | EC2 values |
  | `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 24` (letters and digits only) |
  | `SMTP_*` | step 7b (Render Free blocks ports 25, 465 and 587) |

  `CRON_SECRET` is generated by Render; `SCHEDULER_ENABLED=false`, `TRUST_PROXY=2` and `TELEGRAM_MODE=webhook` are preset.
- **Values to copy:** the service URL (`https://<name>.onrender.com`) and the generated `CRON_SECRET` (service → Environment → reveal).
- **Where to paste:** `vercel.json` (step 4), cron service and GitHub secrets (step 6), Telegram webhook (step 7a).
- **Security warning:** Render Free services are public. Every `/api` route except health, the Telegram webhook (secret header) and the cron endpoint (bearer secret) requires a login session.
- **How to verify:** the deploy log shows `Database is up to date.` (or migrations applied) and `server.started`; `https://<name>.onrender.com/api/v1/readiness` returns `{"status":"ready","database":"ok"}`.

## 4. Vercel project (frontend)

- **Purpose:** serves the web app and proxies `/api/*` to Render, so the browser sees **one origin**. The cookie, CSRF and CORS protections stay unchanged.
- **Where:** first edit `vercel.json` in the repository, then go to vercel.com → **Add New → Project** → import the repository.
- **What to configure:**
  - In `vercel.json`, replace `https://YOUR-RENDER-SERVICE.onrender.com` with your Render URL, then commit and push.
  - In Vercel: **Root Directory = repository root**, Framework preset **Other**. The build, install and output settings come from `vercel.json`. No environment variables are needed.
  - **Settings → Deployment Protection:** keep protection **on for preview deployments**, because previews proxy to the same API.
- **Values to copy:** the production URL (e.g. `https://personal-work-os.vercel.app`, or your custom domain).
- **Where to paste:** Render `APP_URL` and `ZOHO_REDIRECT_URI` (step 5).
- **Security warning:** `vercel.json` re-declares the strict CSP and security headers the API used to send with the HTML. Don't loosen them.
- **How to verify:**
  - `curl -sI https://<vercel-url>/` shows `content-security-policy`.
  - `curl -s https://<vercel-url>/api/v1/health` returns `{"status":"ok"}` (proxied).
  - `curl -sI https://<vercel-url>/api/v1/health` shows `cache-control: no-store`.

## 5. Connect the URLs

- **Purpose:** CORS, OAuth redirects and links inside notifications use `APP_URL`. Zoho's callback must go **through Vercel**, because the OAuth state cookie and session cookie live on the Vercel domain.
- **Where:** Render → service → **Environment**; Zoho API console (the region matching `ZOHO_DATA_CENTER`) → your client → **Authorized Redirect URIs**.
- **What to configure:**
  - `APP_URL=https://<vercel-url>` (no trailing slash)
  - `ZOHO_REDIRECT_URI=https://<vercel-url>/api/v1/integrations/zoho/callback`
  - In Zoho, **add** that URI and **keep** the EC2 one (needed for rollback).
- **Values to copy:** –
- **Where to paste:** as above. Render redeploys automatically.
- **Security warning:** do not point the redirect at the Render URL; the callback would fail its state check.
- **How to verify:** open `https://<vercel-url>`, sign in, reload the page, and you stay signed in. In the browser dev tools, the `pwos_session` cookie is `HttpOnly`, `Secure`, `SameSite=Lax` on the Vercel domain.

## 6. Scheduled jobs (reminders and syncs)

- **Purpose:** Render Free sleeps after 15 idle minutes, so the in-process scheduler is off and an external service triggers the jobs.
- **Where:** a free cron service with per-minute schedules (e.g. cron-job.org) for the **primary** trigger; GitHub → repository → **Settings → Secrets and variables → Actions** for the hourly **backup** trigger (`.github/workflows/cron-tick.yml`).
- **What to configure:**
  1. Cron job A (reminders): `POST https://<name>.onrender.com/api/v1/internal/cron/tick?scope=notifications`, header `Authorization: Bearer <CRON_SECRET>`. Schedule **every 5 minutes** from 07:00 to 23:59 in your timezone (set the job's timezone), and hourly overnight. This covers the 15-minute meeting-reminder window, the 17:00/17:30/23:00/08:30 reminders, and keeps Supabase active.
  2. Cron job B (syncs): same URL with `?scope=sync`, **every 30 minutes**. It honours `ZOHO_SYNC_INTERVAL_MINUTES` / `GITHUB_SYNC_INTERVAL_MINUTES`.
  3. GitHub secrets: `CRON_TICK_URL` = `https://<name>.onrender.com/api/v1/internal/cron/tick`, `CRON_SECRET`.
- **Values to copy:** the Render URL and `CRON_SECRET`.
- **Where to paste:** as above. **Call Render directly**, not through Vercel.
- **Security warning:** the secret grants the ability to run your jobs (it cannot read data). Rotate it by changing it in Render and in both callers. Running jobs every 5 minutes keeps the service awake, which uses most of Render's monthly free instance hours; the overnight hourly schedule reduces that. Check the current allowance on Render's pricing page.
- **How to verify:**
  - The cron service shows HTTP 200 with `"status":"completed"`. The first call after sleep can time out while Render wakes up; the next succeeds.
  - Render logs show `cron.tick`.
  - GitHub → Actions → **Scheduled jobs (backup trigger)** → *Run workflow* succeeds.
  - After a reminder time passes, **Settings → Notification history** shows it.

## 7. Notifications

### 7a. Telegram (webhook)
- **Purpose:** polling does not survive Render's sleep; webhooks wake the service.
- **Where:** a terminal.
- **What to configure:**
  ```bash
  curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
    -d "url=https://<name>.onrender.com/api/v1/telegram/webhook" \
    -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
    -d 'allowed_updates=["message","callback_query"]'
  ```
  **During the rehearsal, use a separate test bot**, because a bot has only one webhook and the production bot must keep serving EC2 until cutover.
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** the webhook rejects requests without the exact secret header.
- **How to verify:** `getWebhookInfo` shows the URL and no `last_error_message`. `/today` to the bot replies (the first reply after sleep can take about a minute).

### 7b. Email
- **Purpose:** Render Free blocks outbound SMTP on 25, 465 and 587.
- **Where:** an SMTP provider that accepts **port 2525** (several transactional providers do; check your provider's docs).
- **What to configure:** `SMTP_HOST`, `SMTP_PORT=2525`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. If no such provider suits you, leave SMTP empty and use Telegram as the channel, with in-app as the fallback.
- **Values to copy:** SMTP credentials.
- **Where to paste:** Render environment.
- **Security warning:** use a provider SMTP key, not a personal mailbox password.
- **How to verify:** **Settings → Test email** reports it was sent.

### 7c. Browser push
- **Purpose:** push subscriptions belong to the browser origin, which is now the Vercel URL.
- **Where:** each device → **Settings → Enable browser notifications here**.
- **What to configure:** nothing server-side (same VAPID keys).
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** –
- **How to verify:** **Test browser push** arrives.

## 8. Nightly encrypted backups

- **Purpose:** Supabase Free has no downloadable backups. `.github/workflows/db-backup.yml` dumps nightly, verifies the dump, encrypts it with **age** to your public key, and keeps it 30 days as a workflow artifact.
- **Where:** your machine (key) and GitHub → **Settings → Secrets and variables → Actions**.
- **What to configure:**
  1. `age-keygen -o pwos-backup.key` (install `age` first). This prints `Public key: age1…`.
  2. Add the GitHub secrets:
     - `BACKUP_DATABASE_URL` = the Supabase Session pooler URL
     - `SUPABASE_CA_CERT` = the **PEM text** of the CA file (not base64)
     - `BACKUP_AGE_RECIPIENT` = the `age1…` public key
- **Values to copy:** the public key only.
- **Where to paste:** GitHub secrets. Store `pwos-backup.key` (the private key) in your password manager **and offline**. Never upload it to GitHub.
- **Security warning:** without the private key the backups cannot be decrypted; with it, anyone who downloads the artifacts can read your data.
- **How to verify:** Actions → **Database backup** → *Run workflow* → download the artifact → `age -d -i pwos-backup.key FILE.sql.gz.age | gunzip | head` shows SQL. Restore it into a scratch database at least once.

## 9. Rehearsal

- **Purpose:** prove everything on a throwaway copy before the real cutover.
- **Where:** EC2 (source) and the throwaway Supabase project from step 3.
- **What to configure:** on EC2, run `docker compose stop app`, then the step 10 script with `TARGET_DATABASE_URL` pointing at the **throwaway** project, then `docker compose start app` (about 1 minute of EC2 downtime; the script refuses to run while the app is up). Then test on the Vercel URL:
  - sign in, dashboard, timesheet add/edit/submit, timer
  - calendar, My work, sprints, reports, CSV/JSON export
  - assistant: a read, a confirmed write, and the Zoho refusal
  - Zoho sync (tokens decrypt with the same key) and GitHub sync
  - Telegram test bot, email, push
  - cron ticks and one backup run
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** the rehearsal database contains real data. Delete that Supabase project afterwards.
- **How to verify:** every item above works, and **Settings → Notification history** shows deliveries.

## 10. Cutover (real data migration)

- **Purpose:** move production data with a short write freeze.
- **Where:** EC2 host (the script uses Docker to run `pg_dump`, `psql` 17 and verified TLS; nothing needs installing).
- **What to configure:**
  1. Point Render's `DATABASE_URL` at the **production** Supabase project (empty). Pause the cron jobs.
  2. On EC2: `docker compose stop app` (the write freeze starts).
  3. Copy the Supabase CA file to the EC2 host, then:
     ```bash
     TARGET_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
     TARGET_SSL_ROOT_CERT=./prod-ca-2021.crt \
     ./scripts/migrate-to-supabase.sh
     ```
     It dumps the `public` schema, refuses a non-empty target, restores in **one transaction**, revokes Data API access (`scripts/supabase-hardening.sql`), and prints `OK: N tables, M rows, identical counts.`
  4. Keep EC2 from sending anything: in the EC2 `.env` set `SCHEDULER_ENABLED=false` and `TELEGRAM_MODE=off` (the app stays stopped anyway).
  5. Redeploy Render (manual deploy). The log shows `Database is up to date.`
  6. Run the production `setWebhook` (step 7a) for the real bot. Resume the cron jobs.
  7. Sign in on the Vercel URL (once, since the domain is new) and re-enable push per device.
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** the script leaves `backups/supabase-migration-*.sql` on EC2 containing all data. Keep it until the migration is final, then delete it.
- **How to verify:** the script prints identical counts. Your latest entries, journal and assistant history appear in the app. A Zoho sync works without reconnecting.

## 11. After cutover

- Watch for a week: cron job history, **Settings → Notification history**, **Sync details**, and Supabase pause-warning emails.
- **New migrations add tables without RLS.** After deploying a release that adds tables, run `scripts/supabase-hardening.sql` in the Supabase SQL editor (it is safe to re-run).
- Never set `TEST_DATABASE_URL` to Supabase; tests wipe the schema. The test setup refuses non-local hosts.
- Keep EC2 stopped (not terminated) for 2–4 weeks.

## 12. Rollback to EC2

1. Pause the cron jobs and suspend the Render service.
2. **If anything was written on Supabase since cutover**, bring it back to EC2:
   ```bash
   docker run --rm -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.crt -v "$PWD/prod-ca-2021.crt:/ca.crt:ro" \
     postgres:17-alpine pg_dump "$SUPABASE_URL" --schema=public --no-owner --no-privileges --clean --if-exists \
     | grep -v -E '^(DROP SCHEMA IF EXISTS public;|CREATE SCHEMA public;|COMMENT ON SCHEMA public IS .*;)$' \
     | gzip > backups/from-supabase.sql.gz
   ./scripts/restore.sh backups/from-supabase.sql.gz
   ```
   `restore.sh` asks for confirmation, stops the app, restores, and starts it.
3. In the EC2 `.env`, restore `SCHEDULER_ENABLED=true` and the previous `TELEGRAM_MODE`. Then run `docker compose up -d`.
4. Re-point Telegram (webhook to the EC2 URL, or `TELEGRAM_MODE=polling`).
5. Sign in on the EC2 URL. The Zoho redirect URI for EC2 is still registered. Tokens and push keys are identical, so nothing needs reconnecting.

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Render build fails with a missing `vite`/`esbuild`/`prisma` | The build command must include `npm ci --include=dev` (it does in `render.yaml`). |
| `self-signed certificate in certificate chain` / `unable to verify the first certificate` | `DATABASE_SSL_CA` is missing or wrong. Re-download the CA from Supabase and re-encode it as base64. |
| `Address family not supported` / `ENETUNREACH` to `db.<ref>.supabase.co` | You used the IPv6 direct host. Use the Session pooler URL. |
| Migration hangs or fails with lock errors | You used port 6543 (transaction pooler). Use 5432 (session). |
| Signed out after every reload | `APP_URL` doesn't match the Vercel URL, or you opened the Render URL directly. Always use the Vercel URL. |
| Zoho "Invalid OAuth state" | `ZOHO_REDIRECT_URI` points at Render instead of Vercel. |
| Login rate-limited unexpectedly | Check the `clientIp` field in Render logs. It should be your public IP; adjust `TRUST_PROXY` (usually `2`). |
| Cron returns 404 | `CRON_SECRET` is not set on Render. 401: the header must be exactly `Authorization: Bearer <secret>`. |
| Reminders missing | Cron job A is paused, not every 5 minutes, or in the wrong timezone. Check the cron history and Render logs for `cron.tick`. |
| Test email times out | You are on port 587/465. Use a provider on port 2525. |
| First request slow (~1 min) | Render Free waking from sleep. Expected. |
