# Database

PostgreSQL, managed with Prisma (`prisma/schema.prisma`). Every user-owned table has a `userId` column, and every query filters by the session user.

## Groups of tables
| Group | Tables | Notes |
|---|---|---|
| Identity | `users`, `sessions`, `user_settings` | Sessions store only the SHA-256 hash of the cookie token. Settings use optimistic `version` locking. |
| Time | `daily_timesheets`, `time_entries`, `timers`, `leave_records`, `holidays` | One timesheet per user per date (DRAFT/SUBMITTED/LOCKED, day type). Entries may have no start/end (duration only). One timer per user (`userId` unique); `accumulatedSeconds` + `segmentStartedAt` keep pause/resume exact. |
| Journal | `journal_entries`, `journal_notes` | One entry per date with seven sections; free-form notes can reference a work item. |
| External snapshots (read-only copies) | `projects`, `sprints`, `work_items`, `work_item_sprint_snapshots`, `calendar_events`, `github_repositories`, `github_activities` | Unique on `(userId, provider, externalId)`. Deleted remote events are soft-deleted (`isDeleted`). |
| Local annotations | `work_item_local`, `calendar_event_local` | Notes, labels, personal status and reminder toggles. Separate tables, so sync upserts never overwrite them. |
| Suggestions | `work_suggestions` | Unique on `(userId, source, sourceRef)`; evidence JSON describes what was *observed*. |
| Integrations | `oauth_tokens`, `zoho_integrations`, `github_integrations`, `sync_states` | Tokens are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`. `sync_states` holds last success/error, cursor and ETag per resource. |
| Notifications | `notifications`, `notification_deliveries`, `notification_preferences`, `push_subscriptions`, `telegram_links`, `telegram_link_tokens` | `notifications.idempotencyKey` is unique: `user:type:source:date`. Link tokens are stored hashed and are single-use. |
| Assistant | `assistant_conversations`, `assistant_messages`, `assistant_action_logs`, `ai_usage_daily` | Action logs hold the confirmation state machine (PROPOSED → AWAITING_CONFIRMATION → CONFIRMED → EXECUTED/FAILED, or CANCELLED). |
| Audit | `audit_logs` | Actor USER/AI/SYSTEM, action, entity, and metadata (never secrets). |

## Migrations
- Apply: `npm run db:migrate` (runs automatically in Docker on start).
- Change the schema: edit `schema.prisma`, run `npm run db:new-migration -- --name what_changed` (Prisma CLI, needs `DATABASE_URL`), review the SQL, commit it.
- Never edit an applied migration; the runner refuses changed checksums.
