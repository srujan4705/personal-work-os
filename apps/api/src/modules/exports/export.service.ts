import { prisma } from '../../lib/prisma';
import { dateToDb, dbToDate, localTime } from '../../lib/time';
import { getUserContext } from '../settings/settings.service';

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export async function timeEntriesCsv(userId: string, from: string, to: string) {
  const ctx = await getUserContext(userId);
  const entries = await prisma.timeEntry.findMany({
    where: { userId, timesheet: { date: { gte: dateToDb(from), lte: dateToDb(to) } } },
    include: { timesheet: { select: { date: true, status: true } }, workItem: { select: { ticketKey: true, title: true } }, project: { select: { name: true } }, sprint: { select: { name: true } } },
    orderBy: [{ timesheet: { date: 'asc' } }, { startTime: 'asc' }],
  });
  return toCsv(
    entries.map((e) => ({
      date: dbToDate(e.timesheet.date), start: e.startTime ? localTime(e.startTime, ctx.tz) : '', end: e.endTime ? localTime(e.endTime, ctx.tz) : '',
      minutes: e.durationMinutes, hours: (e.durationMinutes / 60).toFixed(2), activity: e.activityType, ticket: e.workItem?.ticketKey ?? '',
      ticket_title: e.workItem?.title ?? '', project: e.project?.name ?? '', sprint: e.sprint?.name ?? '', description: e.description ?? '',
      source: e.source, timesheet_status: e.timesheet.status,
    })),
    ['date', 'start', 'end', 'minutes', 'hours', 'activity', 'ticket', 'ticket_title', 'project', 'sprint', 'description', 'source', 'timesheet_status'],
  );
}

/** Full personal data export. Excludes secrets: password hash, sessions, OAuth tokens, link codes, push keys. */
export async function fullExport(userId: string) {
  const where = { userId };
  const [user, settings, timesheets, timeEntries, timers, journal, suggestions, projects, sprints, workItems, events, repos, activities, notifications, prefs, holidays, leave, conversations, actions, audits, sync] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, timezone: true, createdAt: true } }),
      prisma.userSettings.findUnique({ where }),
      prisma.dailyTimesheet.findMany({ where }),
      prisma.timeEntry.findMany({ where }),
      prisma.timer.findMany({ where }),
      prisma.journalEntry.findMany({ where, include: { notesItems: true } }),
      prisma.workSuggestion.findMany({ where }),
      prisma.project.findMany({ where }),
      prisma.sprint.findMany({ where }),
      prisma.workItem.findMany({ where, include: { local: true, snapshots: true } }),
      prisma.calendarEvent.findMany({ where, include: { local: true } }),
      prisma.githubRepository.findMany({ where }),
      prisma.githubActivity.findMany({ where }),
      prisma.notification.findMany({ where, include: { deliveries: true } }),
      prisma.notificationPreference.findMany({ where }),
      prisma.holiday.findMany({ where }),
      prisma.leaveRecord.findMany({ where }),
      prisma.assistantConversation.findMany({ where, include: { messages: true } }),
      prisma.assistantActionLog.findMany({ where }),
      prisma.auditLog.findMany({ where }),
      prisma.syncState.findMany({ where }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    format: 'personal-work-os/v1',
    user, settings, timesheets, timeEntries, timers,
    journal, suggestions,
    external: { projects, sprints, workItems, calendarEvents: events, githubRepositories: repos, githubActivities: activities },
    notifications, notificationPreferences: prefs, holidays, leaveRecords: leave,
    assistant: { conversations, actionLogs: actions },
    auditLogs: audits, syncStates: sync,
  };
}
