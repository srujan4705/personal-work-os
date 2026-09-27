import { prisma } from '../../lib/prisma';
import { dateToDb, dayRangeUtc } from '../../lib/time';
import { getUserContext } from '../settings/settings.service';
import { getTimesheet, submitTimesheet } from '../timesheets/timesheet.service';
import { findUnloggedWork } from '../suggestions/suggestion.service';
import { getJournal, upsertJournal } from '../journal/journal.service';
import { eventsForDate } from '../calendar/calendar.service';

export async function getCloseOut(userId: string, date: string) {
  const ctx = await getUserContext(userId);
  const { start, end } = dayRangeUtc(date, ctx.tz);
  const [sheet, meetings, github, unlogged, journal] = await Promise.all([
    getTimesheet(userId, date),
    eventsForDate(userId, date, ctx.tz),
    prisma.githubActivity.count({ where: { userId, occurredAt: { gte: start, lt: end } } }),
    findUnloggedWork(userId, date),
    getJournal(userId, date),
  ]);
  const tickets = new Set(sheet.entries.map((e) => e.ticketKey).filter(Boolean));
  return {
    date,
    summary: sheet.summary,
    status: sheet.timesheet.status,
    meetings: meetings.filter((m) => !m.isAllDay).length,
    tickets: [...tickets],
    githubActivities: github,
    possibleMissingWork: unlogged.gaps,
    journal: { accomplished: journal?.accomplished ?? '', pending: journal?.pending ?? '', blockers: journal?.blockers ?? '' },
  };
}

/** "Complete Day": saves the journal answers and submits the local timesheet. */
export async function completeDay(userId: string, date: string, input: { accomplished?: string; pending?: string; blockers?: string; submissionNote?: string }) {
  const { submissionNote, ...journal } = input;
  if (Object.values(journal).some((v) => v !== undefined)) await upsertJournal(userId, date, journal);
  const ts = await prisma.dailyTimesheet.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } } });
  if (ts?.status === 'SUBMITTED') return getTimesheet(userId, date);
  return submitTimesheet(userId, date, submissionNote);
}
