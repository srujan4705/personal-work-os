import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { DATE_REGEX, dateToDb, dayRangeUtc, dbToDate, localDate } from '../../lib/time';
import { getUserContext } from '../settings/settings.service';

export const SEARCH_TYPES = ['tickets', 'projects', 'sprints', 'journal', 'entries', 'calendar', 'github', 'repositories'] as const;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  types: z.string().optional().transform((v) => (v ? v.split(',').filter((t): t is (typeof SEARCH_TYPES)[number] => (SEARCH_TYPES as readonly string[]).includes(t)) : [...SEARCH_TYPES])),
  from: z.string().regex(DATE_REGEX).optional(),
  to: z.string().regex(DATE_REGEX).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Deterministic global search over local data (case-insensitive substring). */
export async function search(userId: string, input: z.infer<typeof searchQuerySchema>) {
  const ctx = await getUserContext(userId);
  const { q, limit } = input;
  const has = (t: (typeof SEARCH_TYPES)[number]) => input.types.includes(t);
  const c = { contains: q, mode: 'insensitive' as const };
  const dateFilter = input.from || input.to ? { ...(input.from && { gte: dateToDb(input.from) }), ...(input.to && { lte: dateToDb(input.to) }) } : undefined;
  const instantFilter = input.from || input.to ? { ...(input.from && { gte: dayRangeUtc(input.from, ctx.tz).start }), ...(input.to && { lt: dayRangeUtc(input.to, ctx.tz).end }) } : undefined;
  const none = Promise.resolve([] as never[]);

  const [tickets, projects, sprints, journal, entries, events, github, repos] = await Promise.all([
    has('tickets') ? prisma.workItem.findMany({ where: { userId, OR: [{ ticketKey: c }, { title: c }, { description: c }, { local: { notes: c } }] }, take: limit, select: { id: true, ticketKey: true, title: true, status: true, externalUrl: true } }) : none,
    has('projects') ? prisma.project.findMany({ where: { userId, OR: [{ name: c }, { key: c }] }, take: limit, select: { id: true, name: true, key: true } }) : none,
    has('sprints') ? prisma.sprint.findMany({ where: { userId, OR: [{ name: c }, { goal: c }] }, take: limit, select: { id: true, name: true, status: true } }) : none,
    has('journal') ? prisma.journalEntry.findMany({ where: { userId, ...(dateFilter && { date: dateFilter }), OR: [{ workedOn: c }, { accomplished: c }, { pending: c }, { blockers: c }, { notes: c }, { tomorrow: c }, { lessonsLearned: c }, { notesItems: { some: { content: c } } }] }, take: limit, orderBy: { date: 'desc' } }) : none,
    has('entries') ? prisma.timeEntry.findMany({ where: { userId, ...(dateFilter && { timesheet: { date: dateFilter } }), OR: [{ description: c }, { workItem: { OR: [{ ticketKey: c }, { title: c }] } }] }, take: limit, include: { timesheet: { select: { date: true } }, workItem: { select: { ticketKey: true } } }, orderBy: { createdAt: 'desc' } }) : none,
    has('calendar') ? prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, ...(instantFilter && { startAt: instantFilter }), OR: [{ title: c }, { description: c }] }, take: limit, orderBy: { startAt: 'desc' } }) : none,
    has('github') ? prisma.githubActivity.findMany({ where: { userId, ...(instantFilter && { occurredAt: instantFilter }), OR: [{ title: c }, { ticketKeys: { has: q.toUpperCase() } }, { repository: { fullName: c } }] }, take: limit, include: { repository: { select: { fullName: true } } }, orderBy: { occurredAt: 'desc' } }) : none,
    has('repositories') ? prisma.githubRepository.findMany({ where: { userId, fullName: c }, take: limit, select: { id: true, fullName: true, url: true } }) : none,
  ]);

  const snippet = (j: Record<string, unknown>) => {
    for (const f of ['accomplished', 'workedOn', 'pending', 'blockers', 'notes', 'tomorrow', 'lessonsLearned']) {
      const v = j[f];
      if (typeof v === 'string' && v.toLowerCase().includes(q.toLowerCase())) return v.slice(0, 200);
    }
    return '';
  };

  return {
    query: q,
    tickets,
    projects,
    sprints,
    journal: journal.map((j) => ({ id: j.id, date: dbToDate(j.date), snippet: snippet(j) })),
    entries: entries.map((e) => ({ id: e.id, date: dbToDate(e.timesheet.date), ticketKey: e.workItem?.ticketKey ?? null, description: e.description, durationMinutes: e.durationMinutes, activityType: e.activityType })),
    calendar: events.map((e) => ({ id: e.id, title: e.title, date: localDate(e.startAt, ctx.tz) })),
    github: github.map((g) => ({ id: g.id, type: g.type, title: g.title, repo: g.repository.fullName, url: g.url, date: localDate(g.occurredAt, ctx.tz) })),
    repositories: repos,
  };
}
