import { prisma } from '../../lib/prisma';
import { dateToDb, dayRangeUtc, localTime } from '../../lib/time';
import { getUserContext } from '../settings/settings.service';
import { getTimesheet } from '../timesheets/timesheet.service';
import { listSuggestions } from '../suggestions/suggestion.service';
import { elapsedSeconds } from '../timer/timer.service';
import { safeUrl } from '../calendar/calendar.service';

export type TimelineLabel = 'CONFIRMED' | 'SUGGESTED' | 'OBSERVED' | 'EXTERNAL';
export type TimelineKind = 'TIME_ENTRY' | 'TIMER' | 'MEETING' | 'GITHUB' | 'SUGGESTION' | 'NOTE';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  label: TimelineLabel;
  time: string | null;
  endTime: string | null;
  title: string;
  detail: string | null;
  durationMinutes: number | null;
  url: string | null;
}

/** Chronological view of a day combining confirmed, suggested, observed and external signals. */
export async function getTimeline(userId: string, date: string, now = new Date()) {
  const ctx = await getUserContext(userId);
  const { start, end } = dayRangeUtc(date, ctx.tz);
  const [sheet, events, github, timer, journal, suggestions] = await Promise.all([
    getTimesheet(userId, date),
    prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, startAt: { gte: start, lt: end } }, orderBy: { startAt: 'asc' } }),
    prisma.githubActivity.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, include: { repository: { select: { fullName: true } } } }),
    prisma.timer.findUnique({ where: { userId } }),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } }, include: { notesItems: true } }),
    listSuggestions(userId, date),
  ]);

  const items: TimelineItem[] = [
    ...sheet.entries.map((e) => ({
      id: e.id, kind: 'TIME_ENTRY' as const, label: 'CONFIRMED' as const, time: e.startTime, endTime: e.endTime,
      title: [e.ticketKey, e.ticketTitle ?? e.description ?? e.activityType].filter(Boolean).join(' '), detail: e.activityType, durationMinutes: e.durationMinutes, url: e.ticketUrl,
    })),
    ...events.map((e) => ({
      id: e.id, kind: 'MEETING' as const, label: 'OBSERVED' as const, time: e.isAllDay ? null : localTime(e.startAt, ctx.tz), endTime: e.isAllDay ? null : localTime(e.endAt, ctx.tz),
      title: e.title, detail: e.status === 'CANCELLED' ? 'Cancelled' : e.isAllDay ? 'All day' : null,
      durationMinutes: Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000), url: safeUrl(e.meetingUrl),
    })),
    ...github.map((g) => ({
      id: g.id, kind: 'GITHUB' as const, label: 'OBSERVED' as const, time: localTime(g.occurredAt, ctx.tz), endTime: null,
      title: g.title, detail: `${g.type.replaceAll('_', ' ').toLowerCase()} · ${g.repository.fullName}`, durationMinutes: null, url: g.url,
    })),
    ...suggestions.map((s) => ({
      id: s.id, kind: 'SUGGESTION' as const, label: 'SUGGESTED' as const, time: s.startTime, endTime: s.endTime,
      title: s.description ?? s.activityType, detail: `Suggested from ${s.source.toLowerCase()}`, durationMinutes: s.durationMinutes, url: null,
    })),
    ...(journal?.notesItems ?? []).map((n) => ({
      id: n.id, kind: 'NOTE' as const, label: 'CONFIRMED' as const, time: localTime(n.createdAt, ctx.tz), endTime: null, title: n.content.slice(0, 200), detail: 'Journal note', durationMinutes: null, url: null,
    })),
  ];
  if (timer && timer.startedAt >= start && timer.startedAt < end) {
    items.push({ id: timer.id, kind: 'TIMER', label: 'CONFIRMED', time: localTime(timer.startedAt, ctx.tz), endTime: null, title: `Timer ${timer.status.toLowerCase()}`, detail: timer.activityType, durationMinutes: Math.round(elapsedSeconds(timer, now) / 60), url: null });
  }
  items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  return { date, items, summary: sheet.summary };
}
