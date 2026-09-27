import { prisma } from '../../lib/prisma';
import { addDays, dateToDb, dayRangeUtc, localDate } from '../../lib/time';
import { getUserContext, setNotificationPreference, today, updateSettings } from '../settings/settings.service';
import { addEntry, deleteEntry, getTimesheet, resolveWork, setDayType, submitTimesheet, toEntryDto, updateEntry } from '../timesheets/timesheet.service';
import { getTimer, startTimer, stopTimer } from '../timer/timer.service';
import { appendJournal, deleteJournal, listJournal, upsertJournal } from '../journal/journal.service';
import { acceptSuggestion, findUnloggedWork, ignoreSuggestion, listSuggestions } from '../suggestions/suggestion.service';
import { eventsForDate, getEvent, listEvents } from '../calendar/calendar.service';
import { currentSprint, isDone } from '../work/work.service';
import { monthlyReport, sprintReport, ticketHistory, weeklyReport } from '../reports/report.service';
import { generateRetrospective, generateStandup } from '../reports/standup.service';
import { search, SEARCH_TYPES } from '../search/search.service';
import type { ToolHandlers } from './tool-gateway';

const REMINDER_FIELD = {
  DAILY: 'dailyReminderTime',
  CONFIRMATION: 'confirmationReminderTime',
  TOMORROW_SUMMARY: 'tomorrowSummaryTime',
  MORNING_SUMMARY: 'morningSummaryTime',
} as const;

/**
 * The ONLY implementations the Tool Gateway can run. Every handler calls normal
 * services with the server-side userId — never raw SQL, never external writes.
 */
export const toolHandlers: ToolHandlers = {
  async get_today_summary(_a, { userId }) {
    const ctx = await getUserContext(userId);
    const date = today(ctx);
    const [sheet, events, timer, suggestions, unlogged] = await Promise.all([
      getTimesheet(userId, date), eventsForDate(userId, date, ctx.tz), getTimer(userId), listSuggestions(userId, date), findUnloggedWork(userId, date),
    ]);
    return {
      date, summary: sheet.summary, status: sheet.timesheet.status, dayType: sheet.timesheet.dayType,
      entries: sheet.entries.map((e) => ({ ticket: e.ticketKey, title: e.ticketTitle, activity: e.activityType, minutes: e.durationMinutes, start: e.startTime })),
      meetings: events.map((e) => ({ id: e.id, title: e.title, start: e.startAt, end: e.endAt })),
      timer: timer ? { status: timer.status, elapsedMinutes: Math.round(timer.elapsedSeconds / 60), ticket: timer.ticketKey } : null,
      pendingSuggestions: suggestions.map((s) => ({ id: s.id, description: s.description, minutes: s.durationMinutes, source: s.source, label: 'SUGGESTED' })),
      possibleUntrackedWork: unlogged.gaps.map((g) => g.message),
    };
  },
  get_timesheet: ({ date }, { userId }) => getTimesheet(userId, date),
  async get_time_entries({ from, to, ticket }, { userId }) {
    const ctx = await getUserContext(userId);
    const work = ticket ? await resolveWork(userId, { ticket }) : null;
    const rows = await prisma.timeEntry.findMany({
      where: { userId, timesheet: { date: { gte: dateToDb(from), lte: dateToDb(to) } }, ...(work?.workItemId && { workItemId: work.workItemId }) },
      include: { workItem: { select: { id: true, ticketKey: true, title: true, externalUrl: true } }, project: { select: { id: true, name: true } }, timesheet: { select: { date: true } } },
      orderBy: { timesheet: { date: 'asc' } },
      take: 300,
    });
    return rows.map((r) => ({ ...toEntryDto(r, ctx.tz), date: r.timesheet.date.toISOString().slice(0, 10) }));
  },
  search_work: ({ query, from, to, limit }, { userId }) => search(userId, { q: query, from, to, limit, types: [...SEARCH_TYPES] }),
  async get_current_sprint(_a, { userId }) {
    const sprint = await currentSprint(userId);
    if (!sprint) return { sprint: null, message: 'No active sprint found in synced data.' };
    const items = await prisma.workItem.findMany({ where: { userId, sprintId: sprint.id }, take: 100 });
    return {
      sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, startDate: sprint.startDate, endDate: sprint.endDate, project: sprint.project.name },
      myItems: items.filter((i) => i.isAssignedToMe).map((i) => ({ ticket: i.ticketKey, title: i.title, status: i.status, done: isDone(i) })),
    };
  },
  get_sprint_report: ({ sprint }, { userId }) => sprintReport(userId, sprint),
  async get_weekly_report({ weekOf }, { userId }) {
    return weeklyReport(userId, weekOf ?? today(await getUserContext(userId)));
  },
  get_monthly_report: ({ month }, { userId }) => monthlyReport(userId, month),
  get_calendar_events: ({ from, to }, { userId }) => listEvents(userId, from, to),
  async get_tomorrow_schedule(_a, { userId }) {
    const ctx = await getUserContext(userId);
    const date = addDays(today(ctx), 1);
    const events = (await listEvents(userId, date, date)).filter((e) => !e.isAllDay && e.status !== 'CANCELLED');
    return { date, count: events.length, totalMinutes: events.reduce((s, e) => s + e.durationMinutes, 0), meetings: events.map((e) => ({ title: e.title, start: e.startTime, end: e.endTime, meetingUrl: e.meetingUrl })) };
  },
  get_journal_entries: ({ from, to }, { userId }) => listJournal(userId, from, to),
  async get_github_activity({ from, to }, { userId }) {
    const ctx = await getUserContext(userId);
    const rows = await prisma.githubActivity.findMany({
      where: { userId, occurredAt: { gte: dayRangeUtc(from, ctx.tz).start, lt: dayRangeUtc(to, ctx.tz).end } },
      include: { repository: { select: { fullName: true } } },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    return { label: 'OBSERVED', note: 'GitHub activity is evidence of work, not logged time.', activities: rows.map((r) => ({ type: r.type, title: r.title, repo: r.repository.fullName, date: localDate(r.occurredAt, ctx.tz), tickets: r.ticketKeys, url: r.url })) };
  },
  get_ticket_history: ({ ticket }, { userId }) => ticketHistory(userId, ticket),
  find_unlogged_work: ({ date }, { userId }) => findUnloggedWork(userId, date),
  generate_standup: ({ date }, { userId }) => generateStandup(userId, date),
  generate_retrospective: ({ sprint }, { userId }) => generateRetrospective(userId, sprint),
  async get_settings(_a, { userId }) {
    const ctx = await getUserContext(userId);
    const s = ctx.settings;
    return {
      timezone: ctx.tz, workStartTime: s.workStartTime, workEndTime: s.workEndTime, expectedDailyMinutes: s.expectedDailyMinutes, workingDays: s.workingDays,
      reminders: { daily: s.dailyReminderTime, confirmation: s.confirmationReminderTime, tomorrowSummary: s.tomorrowSummaryTime, morningSummary: s.morningSummaryEnabled ? s.morningSummaryTime : 'off', meetingMinutesBefore: s.meetingReminderMinutes },
      notificationChannel: s.notificationChannel, aiDataMode: s.aiDataMode,
    };
  },
  get_meeting_details: ({ eventId }, { userId }) => getEvent(userId, eventId),

  async add_time_entry(a, { userId }) {
    return addEntry(userId, a.date, { activityType: a.activityType, durationMinutes: a.durationMinutes, ticket: a.ticket, startTime: a.startTime, description: a.description }, { source: 'AI_SUGGESTION', actor: 'AI' });
  },
  update_time_entry: ({ entryId, ...patch }, { userId }) => updateEntry(userId, entryId, patch, 'AI'),
  start_timer: (a, { userId }) => startTimer(userId, a, 'AI'),
  stop_timer: (_a, { userId }) => stopTimer(userId, 'AI'),
  add_journal_entry: ({ date, section, text }, { userId }) => appendJournal(userId, date, section, text, 'AI'),
  update_journal_entry: ({ date, section, text }, { userId }) => upsertJournal(userId, date, { [section]: text }, 'AI'),
  accept_time_suggestion: ({ suggestionId }, { userId }) => acceptSuggestion(userId, suggestionId, {}, 'AI'),
  ignore_time_suggestion: ({ suggestionId }, { userId }) => ignoreSuggestion(userId, suggestionId, 'AI'),
  async set_reminder_time({ reminder, time }, { userId }) {
    const s = await updateSettings(userId, { [REMINDER_FIELD[reminder]]: time, ...(reminder === 'MORNING_SUMMARY' && { morningSummaryEnabled: true }) }, 'AI');
    return { [REMINDER_FIELD[reminder]]: s[REMINDER_FIELD[reminder]] };
  },
  enable_notification: ({ type }, { userId }) => setNotificationPreference(userId, type, { enabled: true }, 'AI'),
  disable_notification: ({ type }, { userId }) => setNotificationPreference(userId, type, { enabled: false }, 'AI'),

  delete_time_entry: ({ entryId }, { userId }) => deleteEntry(userId, entryId, 'AI'),
  delete_journal_entry: ({ date }, { userId }) => deleteJournal(userId, date, 'AI'),
  mark_leave: ({ date, kind }, { userId }) => setDayType(userId, date, kind === 'FULL_DAY' ? 'LEAVE' : 'HALF_DAY', undefined, 'AI'),
  submit_timesheet: ({ date }, { userId }) => submitTimesheet(userId, date, undefined, 'AI'),
};
