# Architecture

## Shape
A **modular monolith**: one repository, one Node.js process, one PostgreSQL database. There are no microservices, queues, Redis or Kubernetes. The scheduler runs in-process and derives its work from the database, so restarts are safe.

```
apps/web  (React PWA) ──HTTP /api/v1──►  apps/api  (Express)
                                         ├─ middleware: helmet, CORS(APP_URL), JSON, cookies, pino-http,
                                         │              CSRF header guard, rate limits, requireAuth
                                         ├─ modules/*  route → service → Prisma → PostgreSQL
                                         ├─ scheduler  (tick every N s, injectable clock)
                                         └─ telegram   (webhook or long polling)
packages/shared        constants/helpers used by both sides
packages/ai-contracts  AI tool allow-list (names, permissions, strict Zod schemas)
```

## Layering
- **Routes** are thin controllers: parse and validate the input (Zod), take the user id from the session (`userOf(req)`), call a service, and return the standard envelope `{ success, data }` or `{ success: false, error: { code, message } }`.
- **Services** own the business rules (timesheet validation, locking, suggestions, reports). They are the only code that touches Prisma. Prisma is the repository layer; wrapping it in hand-written repositories would add a layer without adding safety.
- **Integrations** follow *application service → provider interface → provider implementation*. `sync.service.ts` orchestrates; `integrations/providers.ts` defines read-only interfaces (`list*`/`get*` only); the `zoho/` and `github/` readers implement them on top of `ReadOnlyHttpClient`.
- **The assistant** never touches Prisma. LLM output goes to `ToolGateway.execute()`, which validates the call and runs a handler in `assistant/handlers.ts`; the handlers call the same services the UI uses.

## Modules (apps/api/src/modules)
auth · settings · timesheets · timer · journal · calendar · work (projects/sprints/work items) · suggestions (+ gap detection) · sync · integrations (http, zoho, github, oauth) · notifications (+ providers) · scheduler · reports (+ standup/retrospective) · dashboard (+ close-out) · timeline · search · exports · assistant · ai · telegram · audit · health

## Key flows
- **Log time:** `POST /timesheets/:date/entries` → `addEntry` (ensure timesheet, assert DRAFT, resolve ticket, compute times in the user's timezone) → transaction (create entry, recompute logged minutes) → audit.
- **Sync:** the scheduler or the "Sync now" button → `syncZoho`/`syncGithub` → each resource runs inside `runResource` (records `sync_states`, isolates failures, notifies on failure) → upserts keyed by `(userId, provider, externalId)` → refresh suggestions. Local annotations live in `*_local` tables, so a sync never overwrites them.
- **Suggestions:** calendar events and GitHub activity grouped by ticket key become `work_suggestions` (unique per source ref, so the operation is idempotent). Accepting one creates a normal entry with source `CALENDAR` / `GITHUB_SUGGESTION` / `AI_SUGGESTION`.
- **Notifications:** job → `NotificationService.notify()` claims a unique idempotency key in the database **before** delivering → primary channel → fallback → in-app, and every attempt is recorded.

## Time and timezones
The user's timezone lives only on `users.timezone`. Dates are `YYYY-MM-DD` strings in that timezone, stored as `@db.Date`. Instants are stored in UTC. Conversions use `lib/time.ts` (built on Intl, DST-safe, no dependency).

## Build and runtime
- The Prisma 7 client (`prisma-client` generator) uses the pg driver adapter and needs no native engine binaries.
- The API is bundled by esbuild into `apps/api/dist/server.js` (npm dependencies external). The web app is built by Vite into `apps/web/dist` and served by the API in production.
- Migrations are plain SQL in `prisma/migrations`, applied by `scripts/migrate.ts` (compatible with Prisma's `_prisma_migrations` table; advisory-locked; checksum-verified).
