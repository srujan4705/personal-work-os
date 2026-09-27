import { titleCase } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { dateToDb, localMinutesOfDay, localTime } from '../../lib/time';
import { getUserContext, today } from '../settings/settings.service';
import { getTimesheet } from '../timesheets/timesheet.service';
import { getTimer } from '../timer/timer.service';
import { findUnloggedWork, listSuggestions, refreshSuggestionsForDate } from '../suggestions/suggestion.service';
import { eventsForDate, safeUrl } from '../calendar/calendar.service';
import { currentSprint, isDone } from '../work/work.service';

export async function getDashboard(userId: string, now = new Date()) {
  const ctx = await getUserContext(userId);
  const date = today(ctx, now);
  await refreshSuggestionsForDate(userId, date);
  const [sheet, timer, events, sprint, suggestions, unlogged, journal, recentEntries, recentGithub, openItems, integrations] = await Promise.all([
    getTimesheet(userId, date),
    getTimer(userId),
    eventsForDate(userId, date, ctx.tz),
    currentSprint(userId),
    listSuggestions(userId, date),
    findUnloggedWork(userId, date, now),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } } }),
    prisma.timeEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, include: { workItem: { select: { ticketKey: true, title: true } } } }),
    prisma.githubActivity.findMany({ where: { userId }, orderBy: { occurredAt: 'desc' }, take: 5, include: { repository: { select: { fullName: true } } } }),
    prisma.workItem.findMany({ where: { userId, isAssignedToMe: true }, select: { status: true, externalCompletedAt: true } }),
    Promise.all([prisma.zohoIntegration.findUnique({ where: { userId } }), prisma.githubIntegration.findUnique({ where: { userId } })]),
  ]);
  const hour = Math.floor(localMinutesOfDay(now, ctx.tz) / 60);
  const meetings = events.filter((e) => !e.isAllDay).map((e) => ({
    id: e.id, title: e.title, startTime: localTime(e.startAt, ctx.tz), endTime: localTime(e.endAt, ctx.tz), meetingUrl: safeUrl(e.meetingUrl), startAt: e.startAt,
  }));
  const next = meetings.find((m) => m.startAt > now) ?? null;
  const journalFilled = !!journal && !!(journal.accomplished || journal.workedOn || journal.pending);

  return {
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    name: ctx.name,
    date,
    timesheet: { ...sheet.summary, status: sheet.timesheet.status, dayType: sheet.timesheet.dayType, entriesCount: sheet.entries.length },
    timer,
    meetings,
    nextMeeting: next,
    currentSprint: sprint ? { id: sprint.id, name: sprint.name, goal: sprint.goal, endDate: sprint.endDate } : null,
    openTickets: openItems.filter((w) => !isDone(w)).length,
    suggestions,
    possibleMissingWork: unlogged.gaps,
    journal: { status: journal ? (journalFilled ? 'FILLED' : 'STARTED') : 'NOT_STARTED' },
    recentActivity: [
      ...recentEntries.map((e) => ({ kind: 'TIME_ENTRY', label: 'CONFIRMED', title: e.workItem ? `${e.workItem.ticketKey ?? ''} ${e.workItem.title}`.trim() : e.description ?? titleCase(e.activityType), at: e.createdAt, minutes: e.durationMinutes })),
      ...recentGithub.map((g) => ({ kind: 'GITHUB', label: 'OBSERVED', title: `${g.title} (${g.repository.fullName})`, at: g.occurredAt, minutes: null })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8),
    integrations: { zoho: integrations[0]?.status ?? 'DISCONNECTED', github: integrations[1]?.status ?? 'DISCONNECTED' },
    showCloseOut: localMinutesOfDay(now, ctx.tz) >= Number(ctx.settings.workEndTime.slice(0, 2)) * 60 - 60,
  };
}
