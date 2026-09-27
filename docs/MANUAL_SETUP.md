# Manual setup guide

Everything you must configure by hand, in order. Only **section A** is required; everything else is optional and can be added later. Every step lists its **Purpose**, **Where**, **What to configure**, **Values to copy**, **Where to paste**, a **Security warning**, and **How to verify**.

All settings live in the `.env` file in the project root (copy it from `.env.example`). After editing `.env`, restart the app:

```bash
docker compose up -d          # Docker (re-reads .env and recreates the app container)
# or, without Docker: stop and start `npm start` / `npm run dev`
```

| Section | Topic | Required? |
|---|---|---|
| [A](#a-required-setup) | Required setup: secrets, first user, first start | **Yes** |
| [B](#b-optional-setup-inside-the-app) | Working hours, reminders, timezone (in the app) | Recommended |
| [C](#c-integration-setup-overview) | Integration overview | – |
| [D](#d-production-deployment-https-domain-reverse-proxy) | Production: domain, HTTPS, reverse proxy | For internet access, Telegram webhooks and push |
| [E](#e-notification-setup) | Telegram, email (SMTP), browser push | Optional |
| [F](#f-ai-setup) | Gemini, OpenRouter or Ollama | Optional |
| [G](#g-github-setup-read-only) | GitHub read-only token | Optional |
| [H](#h-zoho-setup-read-only) | Zoho OAuth client (Calendar, Projects, Sprints) | Optional |
| [I](#i-backup-and-restore) | Backups and restore | Strongly recommended |
| [J](#j-troubleshooting) | Troubleshooting | – |

---

## A. Required setup

### A1. Install prerequisites
- **Purpose:** run the app and its database.
- **Where:** the machine that will host the app (your laptop, a home server or a VPS).
- **What to configure:** install Docker with the Compose plugin (Docker Desktop on macOS/Windows; `docker.io` + `docker-compose-plugin` on Linux). Without Docker: Node.js 22+ and PostgreSQL 14+.
- **Values to copy:** none.
- **Where to paste:** –
- **Security warning:** on a server, keep the OS updated and allow only ports 22, 80 and 443 through the firewall. PostgreSQL is **not** published to the host by default; keep it that way.
- **How to verify:** `docker compose version` prints a version.

### A2. Create `.env`
- **Purpose:** holds all configuration and secrets.
- **Where:** project root.
- **What to configure:** `cp .env.example .env`
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** `.env` contains secrets. Never commit or share it (it is already in `.gitignore`). Restrict permissions with `chmod 600 .env`.
- **How to verify:** `ls -l .env` shows the file.

### A3. Database password
- **Purpose:** protects PostgreSQL.
- **Where:** `.env`.
- **What to configure:** `POSTGRES_PASSWORD`. Without Docker, set `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/pwos` instead.
- **Values to copy:** generate one with `openssl rand -base64 24`.
- **Where to paste:** `POSTGRES_PASSWORD=` in `.env`.
- **Security warning:** Compose initialises the database volume with this password on **first start only**. Changing it later requires `ALTER USER pwos PASSWORD '…'` inside the database as well.
- **How to verify:** `docker compose ps` shows `db` as *healthy* after start.

### A4. Token encryption key
- **Purpose:** encrypts OAuth tokens (Zoho) at rest with AES-256-GCM.
- **Where:** `.env`.
- **What to configure:** `TOKEN_ENCRYPTION_KEY`, exactly 64 hex characters.
- **Values to copy:** output of `openssl rand -hex 32`.
- **Where to paste:** `TOKEN_ENCRYPTION_KEY=` in `.env`.
- **Security warning:** **back this key up separately from database backups** (e.g. in a password manager). Anyone with both can decrypt tokens. If you lose it, the app still works, but you must reconnect Zoho.
- **How to verify:** the app starts; a wrong length fails at startup with `TOKEN_ENCRYPTION_KEY: must be 64 hex characters`.

### A5. First user
- **Purpose:** creates your login on first start (only when the database has no users).
- **Where:** `.env`.
- **What to configure:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), `ADMIN_NAME`, `ADMIN_TIMEZONE` (IANA name such as `Asia/Kolkata`, `Europe/London` or `America/New_York`).
- **Values to copy:** your own.
- **Where to paste:** `.env`.
- **Security warning:** after the first successful login, change the password in-app if the `.env` value was ever shared, and optionally remove `ADMIN_PASSWORD` from `.env`, since it is only used when no user exists.
- **How to verify:** the log shows `auth.admin_created` on first start (`docker compose logs app | grep admin`).

### A6. App URL and cookies
- **Purpose:** CORS, cookie security and OAuth redirects all depend on the public URL.
- **Where:** `.env`.
- **What to configure:** `APP_URL` = the exact URL in your browser's address bar, without a trailing slash. Locally: `http://localhost:3000`. In production: `https://work.example.com` (section D).
- **Values to copy:** –
- **Where to paste:** `APP_URL=`
- **Security warning:** in production, session cookies are `Secure` and only sent over HTTPS. For plain-http local use you must set `COOKIE_SECURE=false`, and **never** do that on a server reachable from the internet.
- **How to verify:** you can sign in and stay signed in after a page reload.

### A7. Start
```bash
docker compose up -d --build
docker compose logs -f app      # wait for "server.started"
```
- **How to verify:** `curl http://localhost:3000/api/v1/readiness` returns `{"status":"ready","database":"ok"}`. Open `APP_URL` and sign in.

---

## B. Optional setup inside the app

### B1. Working hours, days and timezone
- **Purpose:** drives expected time, gap detection, reminders and the day ledger.
- **Where:** app → **Settings → Working hours**.
- **What to configure:** timezone, start/end, expected minutes per day (default 480; used for "remaining", never enforced), lunch window (excluded from gap detection), working days, whether submitted days can be reopened.
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** none.
- **How to verify:** the dashboard shows "… logged of 8h" matching your expected time.

### B2. Reminder times
- **Purpose:** decide when you are reminded.
- **Where:** **Settings → Reminders and notifications**.
- **What to configure:** timesheet reminder (default 17:00), confirmation (17:30), tomorrow's schedule (23:00), morning summary (08:30, off by default), meeting reminder minutes (15), preferred channel and fallback channel.
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** none.
- **How to verify:** at the configured time, a notification appears in **Settings → Notification history**. In-app delivery always works even when no channel is set up.

### B3. Install as an app (PWA)
- **Purpose:** home-screen icon and offline app shell.
- **Where:** your browser. Chrome/Edge: install icon in the address bar. iOS Safari: Share → *Add to Home Screen*.
- **Security warning:** requires HTTPS, except on `localhost`.
- **How to verify:** the app opens in its own window.

---

## C. Integration setup overview

| Integration | Access | Needs HTTPS / public URL? | Section |
|---|---|---|---|
| Zoho Calendar, Projects, Sprints | OAuth, **read-only scopes only** | No (OAuth redirect can be `localhost`) | H |
| GitHub | Fine-grained token, **read-only** | No | G |
| Telegram | Bot token | Webhook mode: yes. Polling mode: no | E1 |
| Email | SMTP account | No | E2 |
| Browser push | VAPID keys | Yes (or localhost) | E3 |
| AI | API key or local Ollama | No | F |

Integrations fail independently: a broken integration never blocks the timesheet, journal or reports. Sync errors appear in **Settings → Integrations → Sync details** and as a *Sync problem* notification.

---

## D. Production deployment (HTTPS, domain, reverse proxy)

### D1. Server and domain
- **Purpose:** reach the app from anywhere, and enable Telegram webhooks and push.
- **Where:** any VPS (1 vCPU and 1 GB RAM is enough) and your DNS provider.
- **What to configure:** a DNS **A record** such as `work.example.com` pointing to the server IP. Copy the project to the server (e.g. `/opt/personal-work-os`).
- **Values to copy:** server IP address.
- **Where to paste:** DNS provider → new A record.
- **Security warning:** use SSH keys, disable password SSH login, and enable a firewall (`ufw allow 22,80,443/tcp`).
- **How to verify:** `dig +short work.example.com` returns the server IP.

### D2. HTTPS reverse proxy (Caddy example)
- **Purpose:** TLS certificates and HTTPS termination.
- **Where:** the server.
- **What to configure:** install Caddy and create `/etc/caddy/Caddyfile`:
  ```
  work.example.com {
      encode gzip
      reverse_proxy 127.0.0.1:3000
  }
  ```
  Then `sudo systemctl reload caddy`. Caddy obtains and renews Let's Encrypt certificates automatically. With nginx, use `proxy_pass http://127.0.0.1:3000;` and `proxy_set_header X-Forwarded-Proto $scheme;` plus certbot.
- **Values to copy:** –
- **Where to paste:** –
- **Security warning:** bind the app to localhost only by changing the Compose port to `"127.0.0.1:3000:3000"` so it is reachable only through the proxy.
- **How to verify:** `https://work.example.com/api/v1/health` shows `{"status":"ok"}` with a valid certificate.

### D3. Production `.env`
- **What to configure:** `APP_URL=https://work.example.com`; leave `COOKIE_SECURE` empty (secure by default); update `ZOHO_REDIRECT_URI` to `https://work.example.com/api/v1/integrations/zoho/callback` (and in the Zoho console, section H).
- **How to verify:** sign in works over HTTPS; the browser dev tools show the `pwos_session` cookie as `HttpOnly; Secure; SameSite=Lax`.

### D4. Updating
```bash
git pull   # or replace the files with the new version
docker compose up -d --build     # migrations run automatically on start
```
Run `./scripts/backup.sh` before every update.

---

## E. Notification setup

### E1. Telegram bot
- **Purpose:** reminders and the assistant in Telegram, with Confirm/Cancel buttons for changes.
- **Where:** Telegram → chat with **@BotFather**.
- **What to configure:**
  1. Send `/newbot`, choose a name and a username ending in `bot`.
  2. Pick a mode:
     - **polling** (simplest; works on a laptop or home server without a public URL): `TELEGRAM_MODE=polling`.
     - **webhook** (needs section D): `TELEGRAM_MODE=webhook`, then register the webhook once:
       ```bash
       curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
         -d "url=https://work.example.com/api/v1/telegram/webhook" \
         -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
         -d 'allowed_updates=["message","callback_query"]'
       ```
  3. Restart the app. In **Settings → Telegram**, click **Create link code**, open the link, and press **Start**. The code is single-use and valid for 10 minutes.
- **Values to copy:** the bot token from BotFather (`123456:ABC…`), the bot username, and for webhook mode a secret from `openssl rand -hex 24`.
- **Where to paste:** `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_BOT_USERNAME=` (without `@`), `TELEGRAM_WEBHOOK_SECRET=`.
- **Security warning:** the bot token controls the bot; if leaked, use `/revoke` in BotFather. Only your linked Telegram account, in its private chat, is answered; everyone else gets "not linked". Messages to the bot pass through Telegram's servers.
- **How to verify:** Settings shows *Linked*. Sending `/today` to the bot returns your summary, and **Test telegram** in Settings delivers a message.

### E2. Email (SMTP)
- **Purpose:** email reminders and fallback delivery.
- **Where:** your email provider. Examples:
  - Gmail: enable 2-step verification, then create an *App password* at myaccount.google.com → Security → App passwords. Use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`.
  - A transactional provider (Brevo, Mailgun, Postmark and others offer free tiers): use its SMTP credentials.
- **What to configure:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` only for port 465), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Emails go to your login email address.
- **Values to copy:** the SMTP credentials.
- **Where to paste:** `.env`.
- **Security warning:** use an app password or a provider-specific SMTP key, never your main account password.
- **How to verify:** **Settings → Test email** delivers a message.

### E3. Browser push
- **Purpose:** native notifications on desktop and Android, and on iOS when the app is installed to the Home Screen (iOS 16.4+).
- **Where:** any terminal with Node.js.
- **What to configure:** `npx web-push generate-vapid-keys`
- **Values to copy:** the *Public Key* and *Private Key*, plus a contact such as `mailto:you@example.com`.
- **Where to paste:** `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`, `VAPID_SUBJECT=`.
- **Security warning:** keep the private key secret. Changing the keys invalidates existing subscriptions (re-enable on each device).
- **How to verify:** on each device, **Settings → Enable browser notifications here**, allow permission, then **Test browser push**.

---

## F. AI setup

The app is fully usable without AI. With AI, the assistant answers natural questions and proposes changes, which always go through the Tool Gateway and your confirmation. It can never modify Zoho or GitHub.

### F1. Choose a provider and data mode
- **Purpose:** pick where questions are processed and how much data leaves your server.
- **Where:** `.env` for keys; **Settings → Assistant (AI)** to enable.
- **What to configure:** `AI_PROVIDER` (the default for a new user), then in Settings tick **Use an AI provider** and choose the provider, **Data sent to AI** (*Local only* requires Ollama; *Minimal* strips emails, attendees, descriptions, locations and meeting links; *Full context* strips only secrets), **Confirm before** and **Daily request limit**.
- **Security warning:** with Gemini or OpenRouter, your questions and the minimised data needed to answer them are sent to that provider under its terms. Free tiers may use data to improve their models. Choose Ollama and *Local only* if that is not acceptable.
- **How to verify:** Settings shows "AI is available", and the assistant replies to a free-form question such as "what did I do this week?".

### F2. Google Gemini
- **Where:** https://aistudio.google.com/apikey → *Create API key*.
- **Values to copy:** the API key.
- **Where to paste:** `GEMINI_API_KEY=`; optionally `GEMINI_MODEL=` (default `gemini-2.5-flash`).
- **Security warning:** restrict the key to the Generative Language API in Google Cloud Console.

### F3. OpenRouter
- **Where:** https://openrouter.ai/keys → *Create key*. Choose a model that supports **tool calling**; free models end in `:free`.
- **Values to copy:** the key (`sk-or-…`) and a model id.
- **Where to paste:** `OPENROUTER_API_KEY=`, `OPENROUTER_MODEL=`.
- **Security warning:** set a credit limit on the key in the OpenRouter dashboard.

### F4. Ollama (local, private)
- **Where:** https://ollama.com (install on the host or another machine on your network).
- **What to configure:** `ollama pull llama3.1` (or another model with tool support, such as `qwen2.5`). With Docker on the same host: `OLLAMA_BASE_URL=http://host.docker.internal:11434`, and start Ollama with `OLLAMA_HOST=0.0.0.0` so the container can reach it.
- **Where to paste:** `OLLAMA_BASE_URL=`, `OLLAMA_MODEL=`.
- **Security warning:** do not expose port 11434 to the internet.
- **How to verify:** `curl $OLLAMA_BASE_URL/api/tags` lists your model, and the assistant answers.

### F5. Cost and safety limits (optional)
`AI_MAX_INPUT_CHARS`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_TOOL_ROUNDS`, `AI_RETRY_LIMIT`, `AI_REQUESTS_PER_MINUTE`, `AI_TIMEOUT_MS` in `.env`, plus the daily request limit in Settings. When a limit is hit, the assistant falls back to deterministic commands.

---

## G. GitHub setup (read-only)

### G1. Create a fine-grained, read-only token
- **Purpose:** read your commits, pull requests, reviews and issues as *evidence* for suggestions and ticket history.
- **Where:** github.com → Settings → Developer settings → **Personal access tokens → Fine-grained tokens → Generate new token**.
- **What to configure:**
  - Resource owner: your account, or the organization that owns the work repos. Organizations may require an admin to approve the token.
  - Repository access: *Only select repositories* (recommended) or *All repositories*.
  - Repository permissions, all **Read-only**: **Metadata**, **Contents**, **Pull requests**, **Issues**. Grant nothing else, and never *Read and write*.
  - Expiration: your choice; set a calendar reminder to rotate it.
- **Values to copy:** the token (`github_pat_…`), shown once.
- **Where to paste:** `GITHUB_TOKEN=` in `.env`. Optionally set `GITHUB_REPOS=owner/repo,owner/other` to track only those.
- **Security warning:** do **not** use a classic token with the `repo` scope, because it grants write access. The app only uses GET requests (enforced by tests), but least privilege protects you if the token leaks.
- **How to verify:** restart, then **Settings → Integrations → GitHub → Sync now**. The status shows *Connected as your-login*. Expand *Repositories* to choose which to track and tick *Automatic sync*. Commits that mention ticket keys (e.g. `ER-431`) show up as suggestions and ticket evidence.

---

## H. Zoho setup (read-only)

Personal Work OS requests only these OAuth scopes (all `READ`): `ZohoCalendar.calendar.READ`, `ZohoCalendar.event.READ`, `ZohoProjects.portals.READ`, `ZohoProjects.projects.READ`, `ZohoProjects.tasks.READ`, `ZohoSprints.teams.READ`, `ZohoSprints.projects.READ`, `ZohoSprints.sprints.READ`, `ZohoSprints.items.READ`. If Zoho grants any non-READ scope, the connection is rejected.

### H1. Find your data centre
- **Purpose:** Zoho accounts live in regional data centres with different domains.
- **Where:** look at the address bar when logged in to Zoho: `zoho.com` → `com`, `zoho.eu` → `eu`, `zoho.in` → `in`, `zoho.com.au` → `com.au`, `zoho.jp` → `jp`, `zohocloud.ca` → `ca`, `zoho.sa` → `sa`.
- **Where to paste:** `ZOHO_DATA_CENTER=` in `.env`.
- **How to verify:** the Settings page shows "data centre <value>".

### H2. Register an OAuth client
- **Purpose:** lets you authorise read-only access from Personal Work OS.
- **Where:** the Zoho API Console for your data centre, e.g. https://api-console.zoho.com (or `api-console.zoho.eu`, `.in`, `.com.au`, `.jp`). Click **Add Client → Server-based Applications**.
- **What to configure:**
  - Client Name: `Personal Work OS`
  - Homepage URL: your `APP_URL`
  - Authorized Redirect URIs: `<APP_URL>/api/v1/integrations/zoho/callback`, for example `http://localhost:3000/api/v1/integrations/zoho/callback` or `https://work.example.com/api/v1/integrations/zoho/callback`
- **Values to copy:** **Client ID** and **Client Secret** (Client Secret tab).
- **Where to paste:** `ZOHO_CLIENT_ID=`, `ZOHO_CLIENT_SECRET=`, and the same redirect URI in `ZOHO_REDIRECT_URI=` (it must match exactly, including http/https and port).
- **Security warning:** the client secret is a credential; keep it only in `.env`. Your organization's Zoho admin may need to allow third-party API clients.
- **How to verify:** after a restart, **Settings → Integrations** shows a **Connect Zoho (read-only)** button instead of the "add ZOHO_CLIENT_ID" hint.

### H3. Connect and choose sources
- **Purpose:** authorise access and choose which portal and team to read.
- **Where:** app → **Settings → Integrations → Connect Zoho (read-only)**.
- **What to configure:**
  1. Approve the consent screen; it lists only read permissions.
  2. Back in Settings, click **Choose portal / team**. Pick your **Zoho Projects portal** (projects and tasks) and/or your **Zoho Sprints team** (sprints and sprint items). Leave unused products on *Not used*. Zoho Calendar is always synced.
  3. Click **Sync now**, and tick **Automatic sync** (every `ZOHO_SYNC_INTERVAL_MINUTES`, default 30).
- **Values to copy:** none; the tokens are stored encrypted.
- **Security warning:** **Disconnect** revokes the refresh token at Zoho and deletes local tokens; synced data stays in your database. To revoke from Zoho's side instead, go to accounts.zoho.com → *Connected Apps*.
- **How to verify:** Calendar shows your meetings, My work shows your assigned tasks, Sprints lists sprints, and *Sync details* shows `ok` with a timestamp for each resource.

### H4. If a Zoho resource fails to sync
The mapping of Zoho responses could not be tested against a live account during development (see README → Status). If *Sync details* shows an error for `projects_tasks` or `sprints`:
1. Check that the correct portal or team is selected, and that your Zoho plan includes API access for that product.
2. Set `ZOHO_DEBUG_SHAPES=true`, restart, sync, and run `docker compose logs app | grep zoho.response_shape`. This logs response **keys only**, never content.
3. Adjust the field names in `apps/api/src/modules/integrations/zoho/zoho-sprints.reader.ts` or `zoho-projects.reader.ts`. The read-only tests will still guard against any write call.

---

## I. Backup and restore

### I1. Automatic database backups
- **Purpose:** your timesheets and journal exist only in this database.
- **Where:** the host running Docker Compose.
- **What to configure:** `./scripts/backup.sh` writes `backups/pwos-YYYYMMDD-HHMMSS.sql.gz` and keeps the newest 30. Schedule it daily with `crontab -e`:
  ```
  0 2 * * * cd /opt/personal-work-os && ./scripts/backup.sh >> backups/backup.log 2>&1
  ```
  Copy `backups/` off the server regularly (rclone, restic or similar).
- **Security warning:** backups contain all your work data and encrypted tokens. Store them encrypted. Store `TOKEN_ENCRYPTION_KEY` **separately**.
- **How to verify:** a new `.sql.gz` appears daily; `gunzip -t backups/<file>` reports no errors.

### I2. Restore
```bash
./scripts/restore.sh backups/pwos-20260923-020000.sql.gz   # type "restore" to confirm
```
Test a restore on a spare machine at least once.

### I3. Personal export
**Settings → Your data → Download everything (JSON)** exports all of your records without secrets. **Reports → Export CSV** exports time entries.

---

## J. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| App exits with `Invalid environment configuration` | The log line names the variable. Common causes: `TOKEN_ENCRYPTION_KEY` not 64 hex characters; `ADMIN_PASSWORD` shorter than 12. |
| "No users exist" in the log, cannot sign in | `ADMIN_EMAIL`/`ADMIN_PASSWORD` were missing on first start. Add them and restart. |
| Sign-in succeeds but you are immediately signed out | Using `http://` with secure cookies. Set `COOKIE_SECURE=false` for local http only, or use HTTPS (section D). |
| `Missing CSRF header` from scripts or curl | State-changing API calls need the header `x-pwos-csrf: 1` (the web app sends it automatically). |
| Readiness says `database: unreachable` | `docker compose ps` to check `db`. If you changed `POSTGRES_PASSWORD` after first start, see A3. |
| Zoho "Invalid OAuth state" | You started Connect in one browser or tab and finished in another, or took over 10 minutes. Try again. |
| Zoho `invalid_redirect_uri` | `ZOHO_REDIRECT_URI` and the URI in the Zoho console must match exactly. |
| Zoho `invalid_client` | Wrong data centre: the client was created in a different region's API console than `ZOHO_DATA_CENTER`. |
| GitHub sync `PROVIDER_ERROR` | Token expired, lacks read permission on the repository, or awaits organization approval. |
| Telegram bot silent | Polling: check `TELEGRAM_MODE=polling` and the logs for `telegram.polling_started`. Webhook: run `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and check the URL and last error. Replies "not linked": create a new link code in Settings. |
| Test email fails | Check host, port and `SMTP_SECURE` (465 → `true`, 587 → `false`), and use an app password. |
| Browser push not offered | Needs HTTPS (or localhost), VAPID keys set, and on iOS the app installed to the Home Screen. |
| Assistant says "AI is off" | Enable it in Settings → Assistant and set the provider key in `.env`. LOCAL_ONLY mode only allows Ollama. |
| "Daily AI limit reached" | Raise **Daily request limit** in Settings, or wait until tomorrow. Commands such as `/today` keep working. |
| Reminders not arriving | Check `SCHEDULER_ENABLED=true`, the times and timezone in Settings, and that the day is a working day that is not submitted, on leave or a holiday. Settings → Notification history shows every attempt and error. |
| Wrong day boundaries or times | Set your timezone in Settings → Working hours. |
| Migration error on start | Never edit an applied migration file; the runner detects checksum changes. Restore the original file, then create a new migration. |

Logs: `docker compose logs -f app` (structured JSON; secrets are redacted).
