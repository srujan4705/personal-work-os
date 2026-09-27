import { formatMinutes } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { addDays, dateToDb, dayRangeUtc, isoWeekday, localDate, localTime, parseHm } from '../../lib/time';
import { getUserContext, isWorkingDay, type UserContext } from '../settings/settings.service';
import { templates } from '../notifications/templates';
import type { NotificationService } from '../notifications/notification.service';
import { weeklyReport } from '../reports/report.service';
import { isDone } from '../work/work.service';
import { syncGithub, syncZoho, githubConfigured } from '../sync/sync.service';
import { env } from '../../config/env';

/** A time-of-day job fires once per day, within this window after its configured time. */
const DUE_WINDOW_MINUTES = 30;

export function isDue(nowMinutes: number, target: string, windowMinutes = DUE_WINDOW_MINUTES) {
  const t = parseHm(target);
  return nowMinutes >= t && nowMinutes < t + windowMinutes;
}

async function dayOff(ctx: UserContext, date: string) {
  if (!isWorkingDay(ctx.settings, isoWeekday(date))) return true;
  const [h, l] = await Promise.all([
    prisma.holiday.findUnique({ where: { userId_date: { userId: ctx.userId, date: dateToDb(date) } } }),
    prisma.leaveRecord.findUnique({ where: { userId_date: { userId: ctx.userId, date: dateToDb(date) } } }),
  ]);
  return !!h || l?.kind === 'FULL_DAY';
}

/** 'notifications' = reminders/summaries (fast); 'sync' = Zoho/GitHub syncs (slow); 'all' = both. */
export type JobScope = 'all' | 'notifications' | 'sync';

export interface JobDeps {
  notify: NotificationService;
  now: Date;
  scope?: JobScope;
}

/** Runs every job for one user. Each job is idempotent via the notification key. */
export async function runUserJobs(userId: string, { notify, now, scope = 'all' }: JobDeps) {
  if (scope === 'sync') return runSyncJobs(userId, now);
  const ctx = await getUserContext(userId);
  const s = ctx.settings;
  const date = localDate(now, ctx.tz);
  const nowMin = parseHm(localTime(now, ctx.tz));
  const off = await dayOff(ctx, date);

  // Meeting reminders: events starting within the reminder window (skips cancelled/deleted/opted-out).
  if (s.meetingReminderEnabled) {
    const soon = await prisma.calendarEvent.findMany({
      where: { userId, isDeleted: false, isAllDay: false, status: { not: 'CANCELLED' }, startAt: { gt: now, lte: new Date(now.getTime() + s.meetingReminderMinutes * 60_000) } },
      include: { local: true },
    });
    for (const e of soon) {
      if (e.local?.reminderEnabled === false) continue;
      await notify.notify({
        userId, type: 'MEETING_REMINDER', sourceEntityId: `${e.id}@${e.startAt.toISOString()}`, scheduledDate: date,
        message: templates.meetingReminder({ title: e.title, startTime: localTime(e.startAt, ctx.tz), minutes: Math.max(1, Math.round((e.startAt.getTime() - now.getTime()) / 60000)), meetingUrl: e.meetingUrl?.startsWith('https://') ? e.meetingUrl : null }),
      });
    }
  }

  if (s.morningSummaryEnabled && !off && isDue(nowMin, s.morningSummaryTime)) {
    const { start, end } = dayRangeUtc(date, ctx.tz);
    const [events, items] = await Promise.all([
      prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, status: { not: 'CANCELLED' }, startAt: { gte: start, lt: end } }, orderBy: { startAt: 'asc' } }),
      prisma.workItem.findMany({ where: { userId, isAssignedToMe: true }, select: { status: true, externalCompletedAt: true } }),
    ]);
    await notify.notify({
      userId, type: 'MORNING_SUMMARY', sourceEntityId: 'day', scheduledDate: date,
      message: templates.morningSummary({ meetings: events.map((e) => `${e.isAllDay ? 'All day' : localTime(e.startAt, ctx.tz)} ${e.title}`), expected: formatMinutes(s.expectedDailyMinutes), openTickets: items.filter((i) => !isDone(i)).length }),
    });
  }

  if (!off) {
    const sheet = await prisma.dailyTimesheet.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } }, include: { _count: { select: { entries: true } } } });
    const submitted = sheet?.status === 'SUBMITTED' || sheet?.status === 'LOCKED';
    const logged = sheet?.loggedMinutes ?? 0;
    const expected = sheet?.expectedMinutes ?? s.expectedDailyMinutes;
    if (s.dailyReminderEnabled && !submitted && isDue(nowMin, s.dailyReminderTime)) {
      await notify.notify({ userId, type: 'TIMESHEET_REMINDER', sourceEntityId: 'timesheet', scheduledDate: date, message: templates.timesheetReminder({ logged: formatMinutes(logged), expected: formatMinutes(expected) }) });
    }
    if (s.confirmationReminderEnabled && !submitted && isDue(nowMin, s.confirmationReminderTime)) {
      await notify.notify({ userId, type: 'TIMESHEET_CONFIRMATION', sourceEntityId: 'timesheet', scheduledDate: date, message: templates.timesheetConfirmation({ logged: formatMinutes(logged), entries: sheet?._count.entries ?? 0 }) });
    }
    // Weekly summary on the last working day of the week, at the end of the working day.
    const lastWorkingDay = Math.max(...s.workingDays);
    if (isoWeekday(date) === lastWorkingDay && isDue(nowMin, s.workEndTime)) {
      const r = await weeklyReport(userId, date);
      await notify.notify({ userId, type: 'WEEKLY_SUMMARY', sourceEntityId: r.range.from, scheduledDate: date, message: templates.weeklySummary({ logged: formatMinutes(r.loggedMinutes), expected: formatMinutes(r.expectedMinutes), tickets: r.ticketsWorked, meetings: formatMinutes(r.focusVsMeetings.meetingMinutes) }) });
    }
    // Overdue: the previous working day is still a draft with time logged.
    if (isDue(nowMin, s.workStartTime)) {
      let prev = addDays(date, -1);
      for (let i = 0; i < 7 && !isWorkingDay(s, isoWeekday(prev)); i++) prev = addDays(prev, -1);
      const prevSheet = await prisma.dailyTimesheet.findUnique({ where: { userId_date: { userId, date: dateToDb(prev) } } });
      if (prevSheet?.status === 'DRAFT' && prevSheet.loggedMinutes > 0) {
        await notify.notify({ userId, type: 'TIMESHEET_OVERDUE', sourceEntityId: prev, scheduledDate: date, message: templates.timesheetOverdue({ date: prev, logged: formatMinutes(prevSheet.loggedMinutes) }) });
      }
    }
  }

  if (s.tomorrowSummaryEnabled && isDue(nowMin, s.tomorrowSummaryTime)) {
    const tomorrow = addDays(date, 1);
    if (!(await dayOff(ctx, tomorrow))) {
      const { start, end } = dayRangeUtc(tomorrow, ctx.tz);
      const events = await prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, status: { not: 'CANCELLED' }, startAt: { gte: start, lt: end } }, orderBy: { startAt: 'asc' } });
      await notify.notify({ userId, type: 'TOMORROW_SCHEDULE', sourceEntityId: tomorrow, scheduledDate: date, message: templates.tomorrowSchedule(events.map((e) => `${e.isAllDay ? 'All day' : `${localTime(e.startAt, ctx.tz)}–${localTime(e.endAt, ctx.tz)}`} ${e.title}`)) });
    }
  }

  // Sprint report ready on the sprint's last day.
  if (isDue(nowMin, s.workEndTime)) {
    const ending = await prisma.sprint.findMany({ where: { userId, endDate: dateToDb(date) } });
    for (const sp of ending) {
      await notify.notify({ userId, type: 'SPRINT_REPORT_READY', sourceEntityId: sp.id, scheduledDate: date, message: templates.sprintReportReady({ name: sp.name }) });
    }
  }

  if (scope === 'all') await runSyncJobs(userId, now);
}

/** Background syncs, based on last sync time stored in the database. */
async function runSyncJobs(userId: string, now: Date) {
  const s = (await getUserContext(userId)).settings;
  if (s.zohoSyncEnabled && (await syncDue(userId, 'ZOHO', 'calendar_events', env.ZOHO_SYNC_INTERVAL_MINUTES, now))) {
    await syncZoho(userId, now).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, 'scheduler.zoho_sync_failed'));
  }
  if (s.githubSyncEnabled && githubConfigured() && (await syncDue(userId, 'GITHUB', 'repositories', env.GITHUB_SYNC_INTERVAL_MINUTES, now))) {
    await syncGithub(userId, now).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, 'scheduler.github_sync_failed'));
  }
}

async function syncDue(userId: string, provider: 'ZOHO' | 'GITHUB', resource: string, intervalMinutes: number, now: Date) {
  const state = await prisma.syncState.findUnique({ where: { userId_provider_resource: { userId, provider, resource } } });
  return !state?.lastSyncedAt || now.getTime() - state.lastSyncedAt.getTime() >= intervalMinutes * 60_000;
}
