# Notifications

## Engine
`NotificationService.notify({ userId, type, sourceEntityId, scheduledDate, message })`:
1. Skip if the type is disabled in `notification_preferences`.
2. **Claim** `idempotencyKey = user:type:source:date` by inserting the `notifications` row (unique index). A duplicate means "already handled", so the send is skipped. This makes concurrent ticks and restarts safe.
3. Try channels in order: per-type channel or the Settings channel, then the fallback channel, then IN_APP. Each attempt is recorded in `notification_deliveries`.

Providers implement `NotificationProvider { channel, isAvailable(userId), send(userId, message) }`: Telegram, Email (SMTP via nodemailer), Browser push (web-push/VAPID), In-app. WhatsApp can be added as another provider.

Templates live in `modules/notifications/templates.ts`; edit them to change wording.

## Scheduler (`modules/scheduler`)
`Scheduler.tick()` runs every `SCHEDULER_TICK_SECONDS` with an injectable clock and runs `runUserJobs(userId, { notify, now })` for each active user. Time-of-day jobs fire once, within 30 minutes after their configured local time.

| Type | When | Skipped when |
|---|---|---|
| MEETING_REMINDER | event starts within `meetingReminderMinutes` | cancelled, deleted, all-day, reminder turned off for that meeting |
| MORNING_SUMMARY | `morningSummaryTime` (off by default) | non-working day, holiday or leave |
| TIMESHEET_REMINDER | `dailyReminderTime` (17:00) | submitted, non-working day, holiday or leave |
| TIMESHEET_CONFIRMATION | `confirmationReminderTime` (17:30) | same as above |
| TOMORROW_SCHEDULE | `tomorrowSummaryTime` (23:00) | tomorrow is not a working day |
| WEEKLY_SUMMARY | end of the last working day of the week | – |
| TIMESHEET_OVERDUE | start of the working day | the previous working day is submitted or empty |
| SPRINT_REPORT_READY | end of the sprint's last day | – |
| SYNC_FAILURE | when a sync resource fails (once per resource per day) | – |

Zoho and GitHub syncs are also triggered from the tick, based on `sync_states.lastSyncedAt` and the configured intervals.

**External trigger (hosts that sleep, e.g. Render Free):** set `SCHEDULER_ENABLED=false` and `CRON_SECRET`, then call `POST /api/v1/internal/cron/tick?scope=notifications` every 5 minutes and `?scope=sync` every 30 minutes, with `Authorization: Bearer <CRON_SECRET>`. The same job code runs, so idempotency is unchanged. An in-process guard skips a scope that is still running.
