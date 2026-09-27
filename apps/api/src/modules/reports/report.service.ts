import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { addDays, dateToDb, dayRangeUtc, dbToDate, eachDate, isoWeekday, localDate, localTime, monthRange, startOfIsoWeek } from '../../lib/time';
import { getUserContext, isWorkingDay, type UserContext } from '../settings/settings.service';
import { isDone, resolveSprint } from '../work/work.service';

type Bucket = { key: string; label: string; minutes: number };

function bucket(map: Map<string, Bucket>, key: string, label: string, minutes: number) {
  const b = map.get(key) ?? { key, label, minutes: 0 };
  b.minutes += minutes;
  map.set(key, b);
}
const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.minutes - a.minutes);

async function expectedByDay(ctx: UserContext, from: string, to: string) {
  const [sheets, holidays, leaves] = await Promise.all([
    prisma.dailyTimesheet.findMany({ where: { userId: ctx.userId, date: { gte: dateToDb(from), lte: dateToDb(to) } } }),
    prisma.holiday.findMany({ where: { userId: ctx.userId, date: { gte: dateToDb(from), lte: dateToDb(to) } } }),
    prisma.leaveRecord.findMany({ where: { userId: ctx.userId, date: { gte: dateToDb(from), lte: dateToDb(to) } } }),
  ]);
  const map = new Map<string, number>();
  for (const d of eachDate(from, to)) {
    const sheet = sheets.find((s) => dbToDate(s.date) === d);
    if (sheet) map.set(d, sheet.expectedMinutes);
    else if (holidays.some((h) => dbToDate(h.date) === d)) map.set(d, 0);
    else {
      const leave = leaves.find((l) => dbToDate(l.date) === d);
      const base = isWorkingDay(ctx.settings, isoWeekday(d)) ? ctx.settings.expectedDailyMinutes : 0;
      map.set(d, leave?.kind === 'FULL_DAY' ? 0 : leave?.kind === 'HALF_DAY' ? Math.round(base / 2) : base);
    }
  }
  return { map, sheets };
}

/** Factual report for a date range. Every number is traceable to local records. */
export async function rangeReport(userId: string, from: string, to: string) {
  const ctx = await getUserContext(userId);
  const start = dayRangeUtc(from, ctx.tz).start;
  const end = dayRangeUtc(to, ctx.tz).end;
  const [entries, { map: expected, sheets }, events, github, journal] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, timesheet: { date: { gte: dateToDb(from), lte: dateToDb(to) } } },
      include: { workItem: { select: { id: true, ticketKey: true, title: true, status: true, externalCompletedAt: true, externalUrl: true } }, project: { select: { id: true, name: true } }, timesheet: { select: { date: true } } },
    }),
    expectedByDay(ctx, from, to),
    prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, isAllDay: false, status: { not: 'CANCELLED' }, startAt: { gte: start, lt: end } }, orderBy: { startAt: 'asc' } }),
    prisma.githubActivity.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, include: { repository: { select: { fullName: true } } }, orderBy: { occurredAt: 'asc' } }),
    prisma.journalEntry.findMany({ where: { userId, date: { gte: dateToDb(from), lte: dateToDb(to) } }, orderBy: { date: 'asc' } }),
  ]);

  const byActivity = new Map<string, Bucket>();
  const byProject = new Map<string, Bucket>();
  const byDay = new Map<string, number>();
  const tickets = new Map<string, { workItemId: string; ticketKey: string | null; title: string; minutes: number; sessions: number; isDone: boolean; externalUrl: string | null }>();
  for (const e of entries) {
    bucket(byActivity, e.activityType, e.activityType, e.durationMinutes);
    bucket(byProject, e.project?.id ?? 'none', e.project?.name ?? 'No project', e.durationMinutes);
    const d = dbToDate(e.timesheet.date);
    byDay.set(d, (byDay.get(d) ?? 0) + e.durationMinutes);
    if (e.workItem) {
      const t = tickets.get(e.workItem.id) ?? { workItemId: e.workItem.id, ticketKey: e.workItem.ticketKey, title: e.workItem.title, minutes: 0, sessions: 0, isDone: isDone(e.workItem), externalUrl: e.workItem.externalUrl };
      t.minutes += e.durationMinutes;
      t.sessions += 1;
      tickets.set(e.workItem.id, t);
    }
  }
  const logged = entries.reduce((s, e) => s + e.durationMinutes, 0);
  const expectedTotal = [...expected.values()].reduce((s, v) => s + v, 0);
  const meetingLogged = byActivity.get('MEETING')?.minutes ?? 0;
  const days = eachDate(from, to).map((d) => ({ date: d, loggedMinutes: byDay.get(d) ?? 0, expectedMinutes: expected.get(d) ?? 0, status: sheets.find((s) => dbToDate(s.date) === d)?.status ?? 'NOT_STARTED' }));
  const daysWorked = days.filter((d) => d.loggedMinutes > 0).length;
  const githubByType = new Map<string, Bucket>();
  for (const g of github) bucket(githubByType, g.type, g.type, 1);

  return {
    range: { from, to },
    loggedMinutes: logged,
    expectedMinutes: expectedTotal,
    missingMinutes: Math.max(0, expectedTotal - logged),
    entriesCount: entries.length,
    daysWorked,
    averageMinutesPerWorkedDay: daysWorked ? Math.round(logged / daysWorked) : 0,
    byActivity: sorted(byActivity),
    byProject: sorted(byProject),
    byTicket: [...tickets.values()].sort((a, b) => b.minutes - a.minutes),
    byDay: days,
    focusVsMeetings: { meetingMinutes: meetingLogged, focusMinutes: logged - meetingLogged },
    meetings: {
      observedCount: events.length,
      observedMinutes: events.reduce((s, e) => s + Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000), 0),
      loggedMinutes: meetingLogged,
      list: events.slice(0, 100).map((e) => ({ id: e.id, title: e.title, date: localDate(e.startAt, ctx.tz), startTime: localTime(e.startAt, ctx.tz), label: 'OBSERVED' as const })),
    },
    ticketsWorked: tickets.size,
    ticketsCompleted: [...tickets.values()].filter((t) => t.isDone).map((t) => ({ ticketKey: t.ticketKey, title: t.title })),
    github: {
      total: github.length,
      byType: sorted(githubByType).map((b) => ({ type: b.key, count: b.minutes })),
      recent: github.slice(-20).reverse().map((g) => ({ type: g.type, title: g.title, repo: g.repository.fullName, url: g.url, date: localDate(g.occurredAt, ctx.tz), label: 'OBSERVED' as const })),
    },
    journal: journal.map((j) => ({ date: dbToDate(j.date), workedOn: j.workedOn, accomplished: j.accomplished, pending: j.pending, blockers: j.blockers, tomorrow: j.tomorrow })),
  };
}

export async function dailyReport(userId: string, date: string) {
  return rangeReport(userId, date, date);
}

export async function weeklyReport(userId: string, weekOf: string) {
  const from = startOfIsoWeek(weekOf);
  return rangeReport(userId, from, addDays(from, 6));
}

export async function monthlyReport(userId: string, month: string) {
  const { from, to } = monthRange(month);
  const report = await rangeReport(userId, from, to);
  return { ...report, month, mostActiveProjects: report.byProject.filter((p) => p.key !== 'none').slice(0, 5) };
}

export async function sprintReport(userId: string, sprintRef?: string, now = new Date()) {
  const sprint = await resolveSprint(userId, sprintRef);
  if (!sprint) throw notFound(sprintRef ? `Sprint "${sprintRef}"` : 'Current sprint');
  const ctx = await getUserContext(userId);
  const todayStr = localDate(now, ctx.tz);
  const from = sprint.startDate ? dbToDate(sprint.startDate) : addDays(todayStr, -13);
  const endStr = sprint.endDate ? dbToDate(sprint.endDate) : todayStr;
  const to = endStr > todayStr ? todayStr : endStr;
  const report = await rangeReport(userId, from, to < from ? from : to);

  const items = await prisma.workItem.findMany({ where: { userId, OR: [{ sprintId: sprint.id }, { snapshots: { some: { sprintId: sprint.id } } }] }, include: { snapshots: { include: { sprint: true } } } });
  const workedIds = new Set(report.byTicket.map((t) => t.workItemId));
  const tickets = items.map((w) => {
    const done = isDone(w);
    const laterSprint = w.snapshots.some((s) => s.sprintId !== sprint.id && s.sprint.startDate && sprint.startDate && s.sprint.startDate > sprint.startDate);
    return {
      id: w.id, ticketKey: w.ticketKey, title: w.title, status: w.status, externalUrl: w.externalUrl, isAssignedToMe: w.isAssignedToMe,
      worked: workedIds.has(w.id), completed: done,
      carriedForward: !done && (sprint.status === 'COMPLETED' || laterSprint),
      loggedMinutes: report.byTicket.find((t) => t.workItemId === w.id)?.minutes ?? 0,
    };
  });
  return {
    sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, status: sprint.status, projectName: sprint.project.name, startDate: from, endDate: endStr },
    ...report,
    tickets,
    ticketSummary: {
      total: tickets.length,
      worked: tickets.filter((t) => t.worked).length,
      completed: tickets.filter((t) => t.completed).length,
      carriedForward: tickets.filter((t) => t.carriedForward).length,
    },
    journalHighlights: {
      accomplishments: report.journal.flatMap((j) => (j.accomplished ? [{ date: j.date, text: j.accomplished }] : [])),
      pending: report.journal.flatMap((j) => (j.pending ? [{ date: j.date, text: j.pending }] : [])).slice(-5),
      blockers: report.journal.flatMap((j) => (j.blockers ? [{ date: j.date, text: j.blockers }] : [])),
    },
  };
}

export async function ticketHistory(userId: string, ref: string) {
  const ctx = await getUserContext(userId);
  const item = await prisma.workItem.findFirst({
    where: { userId, OR: [{ id: ref }, { ticketKey: { equals: ref, mode: 'insensitive' } }] },
    include: { local: true, project: { select: { name: true } }, sprint: { select: { name: true } }, snapshots: { include: { sprint: { select: { name: true, status: true } } }, orderBy: { capturedAt: 'asc' } }, journalNotes: { include: { journalEntry: { select: { date: true } } } } },
  });
  if (!item) throw notFound(`Ticket ${ref}`);
  const [entries, github, journal] = await Promise.all([
    prisma.timeEntry.findMany({ where: { userId, workItemId: item.id }, include: { timesheet: { select: { date: true } } }, orderBy: { timesheet: { date: 'asc' } } }),
    item.ticketKey ? prisma.githubActivity.findMany({ where: { userId, ticketKeys: { has: item.ticketKey } }, include: { repository: { select: { fullName: true } } }, orderBy: { occurredAt: 'asc' } }) : Promise.resolve([]),
    item.ticketKey
      ? prisma.journalEntry.findMany({
          where: { userId, OR: ['workedOn', 'accomplished', 'pending', 'blockers', 'notes', 'tomorrow'].map((f) => ({ [f]: { contains: item.ticketKey!, mode: 'insensitive' as const } })) },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const dates = entries.map((e) => dbToDate(e.timesheet.date));
  return {
    workItem: {
      id: item.id, ticketKey: item.ticketKey, title: item.title, description: item.description, status: item.status, priority: item.priority,
      projectName: item.project?.name ?? null, sprintName: item.sprint?.name ?? null, externalUrl: item.externalUrl, isDone: isDone(item), label: 'EXTERNAL' as const,
    },
    local: { notes: item.local?.notes ?? null, labels: item.local?.labels ?? [], personalStatus: item.local?.personalStatus ?? null, personalEstimateMinutes: item.local?.personalEstimateMinutes ?? null },
    firstWorkDate: dates[0] ?? null,
    lastWorkDate: dates[dates.length - 1] ?? null,
    totalLoggedMinutes: entries.reduce((s, e) => s + e.durationMinutes, 0),
    sessions: entries.length,
    entries: entries.map((e) => ({ id: e.id, date: dbToDate(e.timesheet.date), activityType: e.activityType, durationMinutes: e.durationMinutes, description: e.description, label: 'CONFIRMED' as const })),
    journalNotes: item.journalNotes.map((n) => ({ date: dbToDate(n.journalEntry.date), content: n.content })),
    journalMentions: journal.map((j) => ({ date: dbToDate(j.date), accomplished: j.accomplished, pending: j.pending, blockers: j.blockers })),
    githubEvidence: github.map((g) => ({ type: g.type, title: g.title, repo: g.repository.fullName, url: g.url, date: localDate(g.occurredAt, ctx.tz), label: 'OBSERVED' as const })),
    sprintHistory: item.snapshots.map((s) => ({ sprint: s.sprint.name, status: s.status, sprintStatus: s.sprint.status })),
  };
}
