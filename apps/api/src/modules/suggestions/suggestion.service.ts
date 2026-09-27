import { z } from 'zod';
import { ACTIVITY_TYPES } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { dateToDb, dayRangeUtc, dbToDate, localTime } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getUserContext } from '../settings/settings.service';
import { addEntry, getTimesheet } from '../timesheets/timesheet.service';
import { findGaps } from './gap-detection';
import type { AuditActor, TimeEntrySource } from '../../generated/prisma/enums';

/** Creates PENDING suggestions from calendar meetings and GitHub activity for a date (idempotent). */
export async function refreshSuggestionsForDate(userId: string, date: string) {
  const ctx = await getUserContext(userId);
  const { start, end } = dayRangeUtc(date, ctx.tz);

  const events = await prisma.calendarEvent.findMany({
    where: { userId, isDeleted: false, isAllDay: false, status: { not: 'CANCELLED' }, startAt: { gte: start, lt: end } },
  });
  if (events.length) {
    await prisma.workSuggestion.createMany({
      skipDuplicates: true,
      data: events.map((e) => ({
        userId, date: dateToDb(date), source: 'CALENDAR' as const, sourceRef: e.id, activityType: 'MEETING' as const,
        startTime: e.startAt, endTime: e.endAt, durationMinutes: Math.max(1, Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000)),
        description: e.title, evidence: { kind: 'calendar_event', title: e.title, label: 'OBSERVED' },
      })),
    });
  }

  const activities = await prisma.githubActivity.findMany({
    where: { userId, occurredAt: { gte: start, lt: end }, NOT: { ticketKeys: { isEmpty: true } } },
    include: { repository: { select: { fullName: true } } },
    orderBy: { occurredAt: 'asc' },
  });
  const byKey = new Map<string, typeof activities>();
  for (const a of activities) for (const k of a.ticketKeys) byKey.set(k, [...(byKey.get(k) ?? []), a]);

  for (const [key, acts] of byKey) {
    const item = await prisma.workItem.findFirst({ where: { userId, ticketKey: { equals: key, mode: 'insensitive' } }, select: { id: true, projectId: true } });
    if (item) {
      const logged = await prisma.timeEntry.count({ where: { userId, workItemId: item.id, timesheet: { date: dateToDb(date) } } });
      if (logged > 0) continue;
    }
    const first = acts[0]!.occurredAt;
    const last = acts[acts.length - 1]!.occurredAt;
    const span = Math.round((last.getTime() - first.getTime()) / 60000);
    const suggested = Math.min(240, Math.max(15, Math.round(span / 15) * 15));
    await prisma.workSuggestion.createMany({
      skipDuplicates: true,
      data: [{
        userId, date: dateToDb(date), source: 'GITHUB', sourceRef: `github:${date}:${key}`, workItemId: item?.id ?? null, projectId: item?.projectId ?? null,
        activityType: 'DEVELOPMENT', durationMinutes: suggested, description: `${key}: ${acts[0]!.title}`.slice(0, 300),
        evidence: {
          kind: 'github_activity', label: 'OBSERVED', ticketKey: key,
          basis: `Suggested duration based on ${acts.length} observed GitHub activit${acts.length === 1 ? 'y' : 'ies'} between ${localTime(first, ctx.tz)} and ${localTime(last, ctx.tz)}. Not proof of exact working time.`,
          activities: acts.slice(0, 10).map((a) => ({ type: a.type, title: a.title, repo: a.repository.fullName, at: a.occurredAt })),
        },
      }],
    });
  }
}

export async function listSuggestions(userId: string, date: string) {
  const ctx = await getUserContext(userId);
  const rows = await prisma.workSuggestion.findMany({ where: { userId, date: dateToDb(date), status: 'PENDING' }, orderBy: { startTime: { sort: 'asc', nulls: 'last' } } });
  const eventIds = rows.filter((r) => r.source === 'CALENDAR').map((r) => r.sourceRef);
  const events = await prisma.calendarEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, externalId: true, isDeleted: true, status: true } });
  const logged = await prisma.timeEntry.findMany({ where: { userId, externalId: { in: events.map((e) => e.externalId) } }, select: { externalId: true } });
  const loggedSet = new Set(logged.map((l) => l.externalId));
  const workItems = await prisma.workItem.findMany({ where: { id: { in: rows.map((r) => r.workItemId).filter((x): x is string => !!x) } }, select: { id: true, ticketKey: true, title: true } });

  return rows
    .filter((r) => {
      if (r.source !== 'CALENDAR') return true;
      const e = events.find((x) => x.id === r.sourceRef);
      return e && !e.isDeleted && e.status !== 'CANCELLED' && !loggedSet.has(e.externalId);
    })
    .map((r) => {
      const wi = workItems.find((w) => w.id === r.workItemId);
      return {
        id: r.id, source: r.source, label: 'SUGGESTED' as const, activityType: r.activityType, durationMinutes: r.durationMinutes,
        startTime: r.startTime ? localTime(r.startTime, ctx.tz) : null, endTime: r.endTime ? localTime(r.endTime, ctx.tz) : null,
        description: r.description, ticketKey: wi?.ticketKey ?? null, ticketTitle: wi?.title ?? null, evidence: r.evidence,
      };
    });
}

export const acceptOverridesSchema = z.strictObject({
  activityType: z.enum(ACTIVITY_TYPES).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  ticket: z.string().max(64).optional(),
  description: z.string().max(1000).nullable().optional(),
});

const SOURCE_MAP: Record<string, TimeEntrySource> = { CALENDAR: 'CALENDAR', GITHUB: 'GITHUB_SUGGESTION', GAP_DETECTION: 'AI_SUGGESTION', AI: 'AI_SUGGESTION' };

export async function acceptSuggestion(userId: string, id: string, overrides: z.infer<typeof acceptOverridesSchema> = {}, actor: AuditActor = 'USER') {
  const s = await prisma.workSuggestion.findFirst({ where: { id, userId } });
  if (!s) throw notFound('Suggestion');
  if (s.status !== 'PENDING') throw badRequest('SUGGESTION_RESOLVED', `This suggestion was already ${s.status.toLowerCase()}.`);
  const ctx = await getUserContext(userId);
  const date = dbToDate(s.date);
  const event = s.source === 'CALENDAR' ? await prisma.calendarEvent.findFirst({ where: { id: s.sourceRef, userId } }) : null;
  const sameDayTimes = s.startTime && s.endTime && localTime(s.endTime, ctx.tz) > localTime(s.startTime, ctx.tz);
  const entry = await addEntry(
    userId,
    date,
    {
      activityType: overrides.activityType ?? s.activityType,
      workItemId: overrides.ticket ? undefined : s.workItemId,
      ticket: overrides.ticket,
      durationMinutes: overrides.durationMinutes ?? (sameDayTimes ? undefined : s.durationMinutes ?? undefined),
      startTime: overrides.startTime !== undefined ? overrides.startTime : sameDayTimes ? localTime(s.startTime!, ctx.tz) : null,
      endTime: overrides.endTime !== undefined ? overrides.endTime : sameDayTimes ? localTime(s.endTime!, ctx.tz) : null,
      description: overrides.description !== undefined ? overrides.description : s.description,
    },
    { source: SOURCE_MAP[s.source] ?? 'AI_SUGGESTION', actor, externalProvider: event ? event.provider : null, externalId: event ? event.externalId : null },
  );
  await prisma.workSuggestion.update({ where: { id }, data: { status: 'ACCEPTED', timeEntryId: entry.id, resolvedAt: new Date() } });
  await audit(userId, actor, 'suggestion.accepted', 'WorkSuggestion', id, { source: s.source });
  return entry;
}

export async function ignoreSuggestion(userId: string, id: string, actor: AuditActor = 'USER') {
  const res = await prisma.workSuggestion.updateMany({ where: { id, userId, status: 'PENDING' }, data: { status: 'IGNORED', resolvedAt: new Date() } });
  if (res.count === 0) throw notFound('Pending suggestion');
  await audit(userId, actor, 'suggestion.ignored', 'WorkSuggestion', id);
  return { ignored: true };
}

/** Possible untracked windows for a date, based on observed activity. */
export async function findUnloggedWork(userId: string, date: string, now = new Date()) {
  const ctx = await getUserContext(userId);
  const { start, end } = dayRangeUtc(date, ctx.tz);
  const [sheet, events, timer, activities] = await Promise.all([
    getTimesheet(userId, date),
    prisma.calendarEvent.findMany({ where: { userId, isDeleted: false, isAllDay: false, status: { not: 'CANCELLED' }, startAt: { lt: end }, endAt: { gt: start } } }),
    prisma.timer.findUnique({ where: { userId } }),
    prisma.githubActivity.findMany({ where: { userId, occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: 'asc' } }),
  ]);
  if (sheet.timesheet.dayType === 'LEAVE' || sheet.timesheet.dayType === 'HOLIDAY') return { date, gaps: [], note: 'Day marked as leave/holiday.' };
  const busy = [
    ...sheet.entries.filter((e) => e.startAt && e.endAt).map((e) => ({ start: e.startAt!, end: e.endAt! })),
    ...events.map((e) => ({ start: e.startAt, end: e.endAt })),
    ...(timer ? [{ start: timer.startedAt, end: now }] : []),
  ];
  const gaps = findGaps({
    date, tz: ctx.tz, workStartTime: ctx.settings.workStartTime, workEndTime: ctx.settings.workEndTime,
    lunchStart: ctx.settings.lunchStart, lunchEnd: ctx.settings.lunchEnd, busy,
    observed: activities.map((a) => ({ at: a.occurredAt, label: `${a.type.replaceAll('_', ' ').toLowerCase()}: ${a.title}` })), now,
  });
  const untimedMinutes = sheet.entries.filter((e) => !e.startAt).reduce((s, e) => s + e.durationMinutes, 0);
  return {
    date,
    loggedMinutes: sheet.summary.loggedMinutes,
    expectedMinutes: sheet.summary.expectedMinutes,
    untimedMinutes,
    gaps: gaps.map((g) => ({
      start: localTime(g.start, ctx.tz), end: localTime(g.end, ctx.tz), minutes: g.minutes, label: 'SUGGESTED' as const,
      message: `Possible untracked work between ${localTime(g.start, ctx.tz)} and ${localTime(g.end, ctx.tz)}.`,
      observed: g.observed.map((o) => ({ at: localTime(o.at, ctx.tz), label: o.label })),
    })),
    note: untimedMinutes > 0 ? `${untimedMinutes} minutes are logged without start/end times, so some gaps may already be covered.` : null,
  };
}
