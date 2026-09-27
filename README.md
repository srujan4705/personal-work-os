# Personal Work OS

A self-hosted, single-user app that keeps **your own record of your work**: what you worked on, how long, which tickets, which meetings, what you accomplished, what is pending, and what your GitHub activity says happened, so timesheets, standups and sprint reviews are fast and factual.

> External systems provide information; Personal Work OS owns your personal work record.

- **Zoho is strictly read-only.** Calendar, Projects and Sprints are only read and copied into the local database. Nothing is ever created, edited or deleted in Zoho, and the automated tests fail if write code appears.
- **GitHub is read-only evidence**, never proof of time. The app never logs time on its own.
- **The local PostgreSQL database is the source of truth** for timesheets, entries, the journal, notes, reminders, notifications, assistant history and settings.
- **AI is optional.** Everything works without it. When it is enabled, the AI can only call an allow-listed set of tools through a Tool Gateway, and every change requires your confirmation.

---

## Quick start (Docker, recommended)

You need Docker with the Compose plugin.

```bash
tar -xzf personal-work-os.tar.gz && cd personal-work-os
cp .env.example .env
# Edit .env and set at least these:
#   POSTGRES_PASSWORD      any long random string
#   TOKEN_ENCRYPTION_KEY   run: openssl rand -hex 32
#   ADMIN_EMAIL / ADMIN_PASSWORD (min 12 chars) / ADMIN_TIMEZONE (e.g. Asia/Kolkata)
#   APP_URL                http://localhost:3000 for local use
#   COOKIE_SECURE=false    only while you use plain http://localhost
docker compose up -d --build
```

Open **http://localhost:3000** and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Migrations run automatically on every start.

Everything else is optional: Zoho, GitHub, Telegram, email, push and AI. **See [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md)** for every step, including HTTPS for production.

## Deployment options

| Option | Cost | Guide |
|---|---|---|
| Docker Compose on your own server or VM (e.g. EC2) | server cost | [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md), [docs/deployment.md](docs/deployment.md) |
| **Vercel (web) + Render Free (API) + Supabase Free (Postgres)** | free tier | [docs/FREE_TIER_DEPLOYMENT.md](docs/FREE_TIER_DEPLOYMENT.md), background in [docs/EC2_TO_FREE_TIER_MIGRATION.md](docs/EC2_TO_FREE_TIER_MIGRATION.md) |

Both run the same code. The free-tier settings (`CRON_SECRET`, `SCHEDULER_ENABLED=false`, `DATABASE_SSL_CA`, `TRUST_PROXY`) are off by default, so a Docker deployment behaves exactly as before.

## Quick start (without Docker, for development)

Requirements: Node.js 22+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env              # set DATABASE_URL, TOKEN_ENCRYPTION_KEY, ADMIN_*; APP_URL=http://localhost:5173
npm run prisma:generate
npm run db:migrate
npm run db:seed                   # optional demo data (a sprint, tickets, meetings, commits); start the app once first
npm run dev                       # API on :3000, web on :5173 (proxies /api)
```

Production without Docker: `npm run build && npm start` (serves the web app from the API on `PORT`).

## What you can do

| Area | What it does |
|---|---|
| **Today (dashboard)** | Logged vs expected time, a *day ledger* strip (confirmed, suggested and observed activity across your working hours), the timer, suggestions waiting for review, possible untracked gaps, today's meetings with join links, sprint, open tickets, journal status, recent activity. |
| **Timesheet** | Add time in seconds (ticket autocomplete, `30m`/`1.5h`/`1h 15m`, quick buttons), start/end or duration only, edit, duplicate, split, merge and delete. Mark leave, half-day or holiday. Weekly strip. Errors (impossible entries) are separate from warnings (overlap, duplicate, outside hours, missing time). Submit or reopen a day, **locally only**. Exactly 8 hours is never forced. |
| **Timer** | One active timer, stored in the database so it survives refreshes and devices. Pause and resume. Stopping it creates a draft entry. |
| **Calendar** | Agenda, day, week and month views of synced Zoho meetings. Log a meeting as time, ignore it, add a private note, or turn its reminder off. |
| **Suggestions** | Meetings, and GitHub activity grouped by ticket, become *suggestions*. You add, edit or ignore them; nothing is auto-logged. Gap detection flags “Possible untracked work between X and Y” with the observed evidence. |
| **My work / Ticket detail** | Assigned tickets with local-only notes, labels, personal status and estimates. Ticket history shows total time, sessions, first/last dates, journal mentions, GitHub evidence and sprint history. |
| **Timeline** | A chronological view of a day, every item labelled **Confirmed**, **Suggested**, **Observed** or **From Zoho**. |
| **Journal** | What I worked on, accomplished, pending, blockers, notes, tomorrow and lessons learned, plus quick notes. Independent of Zoho. |
| **Close out** | End-of-day flow: review the day, answer three questions, save and submit. |
| **Reports** | Daily, weekly and monthly. Time by day, activity, project and ticket; focus vs meetings; tickets worked and completed; GitHub counts. CSV export. Weekly summary and next-week focus drafts (factual, editable, optional AI). **No productivity scores or rankings.** |
| **Sprints** | Sprint report (time, tickets completed and carried forward, daily distribution, journal highlights) and a retrospective built from your data. |
| **Standup** | Yesterday / Today / Blockers from real entries and the journal. Missing information is listed as missing, never invented. |
| **Assistant** | Web drawer (Ctrl/⌘ K) and Telegram. Answers from your data through allow-listed tools. Any change needs a Confirm. Commands `/today /tomorrow /timesheet /sprint /summary /standup /gaps /help` work without AI. |
| **Notifications** | Meeting reminders, timesheet reminder (17:00) and confirmation (17:30), tomorrow's schedule (23:00), optional morning summary, weekly summary, sprint-report-ready, overdue timesheet and sync failures. Delivered via Telegram, email, browser push or in-app, with fallback and history. Every time is configurable in Settings. |
| **Search** | One box across tickets, projects, sprints, journal, entries, meetings, commits, PRs and repositories. |
| **Export** | Full JSON export of all your data (no secrets) and CSV of time entries. |

## Architecture in one picture

```
Browser (React PWA) ─┐
Telegram bot ────────┼─► Express API (modular monolith, Zod-validated, cookie sessions + CSRF header)
                     │      ├─ Services (timesheets, timer, journal, reports, …) ─► Prisma ─► PostgreSQL (source of truth)
                     │      ├─ Scheduler (in-process, DB-driven, idempotent notifications)
                     │      ├─ Sync ─► Read-only providers ─► ReadOnlyHttpClient (GET only, host allow-list)
                     │      │                                   ├─ Zoho Calendar / Projects / Sprints
                     │      │                                   └─ GitHub REST
                     │      └─ Assistant ─► AI provider (Gemini/OpenRouter/Ollama/none)
                     │                         └─► TOOL GATEWAY (allow-list, Zod args, permission tier,
                     │                                           confirmation state machine, audit)
                     │                                  └─► the same services as the UI (never SQL, never external writes)
```

- One repository, one process, one database. No queues, Redis, Kubernetes or paid services.
- Layering: route (thin controller) → service → Prisma (the repository layer) → PostgreSQL. Integrations go through application service → provider interface → provider implementation.
- Details: [docs/architecture.md](docs/architecture.md), [database](docs/database.md), [integrations](docs/integrations.md), [AI assistant](docs/ai-assistant.md), [notifications](docs/notifications.md), [security](docs/security.md), [deployment](docs/deployment.md).

## Repository layout

```
apps/
  api/                 Express + Prisma backend
    src/config         Zod-validated environment
    src/lib            prisma, logger, errors, crypto, timezone helpers
    src/middleware     auth (session cookie), CSRF guard, rate limits
    src/modules/       auth, settings, timesheets, timer, journal, calendar, work, suggestions,
                       sync, integrations (zoho, github, oauth, read-only HTTP client),
                       notifications (+ telegram/email/webpush/in-app providers), scheduler,
                       reports (+ standup/retro), dashboard (+ close-out), timeline, search,
                       exports, assistant (tool gateway, handlers, deterministic commands),
                       ai (providers, cost guard), telegram, audit, health
    scripts/           migrate.ts (engine-free migration runner), seed.ts, build.mjs
    test/              Vitest + Supertest (unit and integration against real PostgreSQL)
  web/                 React + Vite + Tailwind + React Query PWA
packages/
  shared/              constants and helpers shared by API and web
  ai-contracts/        the AI tool allow-list: names, permissions, strict Zod input schemas
prisma/                schema.prisma + SQL migrations
docker/Dockerfile      multi-stage production image
docker-compose.yml     app + PostgreSQL
scripts/               backup.sh / restore.sh
docs/                  architecture and the manual setup guide
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) and web (Vite) together. |
| `npm run build` | Generates the Prisma client and builds web and API (`apps/*/dist`). |
| `npm start` | Runs migrations, then the production server. |
| `npm run db:migrate` | Applies `prisma/migrations/*` (compatible with Prisma's `_prisma_migrations` table). |
| `npm run db:new-migration -- --name x` | Creates a new migration after editing `schema.prisma` (Prisma CLI). |
| `npm run db:seed` | Demo data for local development. |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript for API, packages and web. |
| `npm test` | API unit and integration tests (needs PostgreSQL; see below) plus web component tests. |
| `npm run check` | lint + typecheck + tests + build. |
| `./scripts/backup.sh` / `./scripts/restore.sh <file>` | Database backup and restore with Docker Compose. |

**Tests:** integration tests use a separate database, `TEST_DATABASE_URL` (default `postgresql://pwos:pwos@localhost:5432/pwos_test`), and recreate its schema on every run. Never point it at real data.

## Guarantees enforced by automated tests

- Zoho and GitHub provider code contains no POST/PUT/PATCH/DELETE, `fetch`, GraphQL or HTTP-library imports. The read-only HTTP client only issues GET, only over https, and only to allow-listed hosts. Zoho OAuth scopes are all `*.READ`.
- The AI tool registry is strict: unknown tools are rejected, schemas accept no unknown keys (including `userId`), and external data sources are read-only.
- LOCAL_WRITE and DANGEROUS_WRITE tools wait for confirmation. Confirmation happens exactly once, only by the owner, and expires. The assistant refuses to modify Zoho.
- Users can never read or change another user's records. Client-supplied user IDs are rejected.
- Notifications are idempotent per (user, type, source, date), including under concurrent scheduler ticks. Reminders respect holidays, submitted timesheets, per-type opt-outs and configured times. Channel fallback works.
- Timesheet CRUD, overlaps, locking after submit, leave/half-day, timer lifecycle, journal CRUD, calendar suggestions, Telegram linking and authorisation, CSV formula-injection guard, and exports without secrets.

- The external cron endpoint rejects missing or wrong secrets, is disabled without `CRON_SECRET`, runs jobs idempotently per scope, and API responses are never cacheable.

Current result: **94 tests** (87 API + 7 web), all passing.

## Status and known limitations

- **Zoho response mapping has not been verified against a live Zoho account.** Endpoints and fields follow Zoho's REST APIs (Calendar v1, Projects REST v1, Sprints `zsapi`); Zoho Sprints in particular returns unusual columnar payloads. If a sync fails, the error appears in Settings → Integrations → Sync details and nothing local is affected. `ZOHO_DEBUG_SHAPES=true` logs response keys (never values) to help adjust the mapping in `apps/api/src/modules/integrations/zoho/`.
- The Docker image and Compose file were not built in the development sandbox (no Docker daemon there). The same build steps they run (`npm ci`, `prisma generate`, web and API builds, migration runner, production server) were run and verified directly.
- Single user by design (V1). The data model is scoped by `userId` everywhere, so multiple users are possible later.
- WhatsApp is intentionally not implemented; the `NotificationProvider` interface is where it would plug in.
- Streaming AI replies are not implemented; replies arrive whole.
