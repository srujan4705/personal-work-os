import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { dateToDb, dayRangeUtc, localDate, localTime } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getUserContext } from '../settings/settings.service';
import { acceptSuggestion, acceptOverridesSchema, ignoreSuggestion, refreshSuggestionsForDate } from '../suggestions/suggestion.service';
import type { CalendarEvent, CalendarEventLocal } from '../../generated/prisma/client';

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function toEventDto(e: CalendarEvent & { local: CalendarEventLocal | null }, tz: string, logStatus?: string, projectName?: string | null) {
  return {
    id: e.id,
    title: e.title,
    date: localDate(e.startAt, tz),
    startAt: e.startAt,
    endAt: e.endAt,
    startTime: localTime(e.startAt, tz),
    endTime: localTime(e.endAt, tz),
    durationMinutes: Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000),
    isAllDay: e.isAllDay,
    status: e.status,
    location: e.location,
    meetingUrl: safeUrl(e.meetingUrl),
    organizer: e.organizer,
    description: e.description,
    label: 'OBSERVED' as const,
    local: { note: e.local?.note ?? null, category: e.local?.category ?? null, projectId: e.local?.projectId ?? null, reminderEnabled: e.local?.reminderEnabled ?? true },
    projectName: projectName ?? null,
    logStatus: logStatus ?? 'PENDING',
  };
}

export async function listEvents(userId: string, from: string, to: string) {
  const ctx = await getUserContext(userId);
  const events = await prisma.calendarEvent.findMany({
    where: { userId, isDeleted: false, startAt: { gte: dayRangeUtc(from, ctx.tz).start, lt: dayRangeUtc(to, ctx.tz).end } },
    include: { local: true },
    orderBy: { startAt: 'asc' },
    take: 1000,
  });
  const [entries, suggestions, projects] = await Promise.all([
    prisma.timeEntry.findMany({ where: { userId, externalId: { in: events.map((e) => e.externalId) } }, select: { externalId: true } }),
    prisma.workSuggestion.findMany({ where: { userId, source: 'CALENDAR', sourceRef: { in: events.map((e) => e.id) } }, select: { sourceRef: true, status: true } }),
    prisma.project.findMany({ where: { userId, id: { in: events.map((e) => e.local?.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const logged = new Set(entries.map((e) => e.externalId));
  return events.map((e) => {
    const s = suggestions.find((x) => x.sourceRef === e.id);
    const status = logged.has(e.externalId) ? 'LOGGED' : s?.status === 'IGNORED' ? 'IGNORED' : 'PENDING';
    return toEventDto(e, ctx.tz, status, projects.find((p) => p.id === e.local?.projectId)?.name);
  });
}

export async function getEvent(userId: string, id: string) {
  const ctx = await getUserContext(userId);
  const e = await prisma.calendarEvent.findFirst({ where: { id, userId }, include: { local: true } });
  if (!e) throw notFound('Calendar event');
  const logged = await prisma.timeEntry.count({ where: { userId, externalId: e.externalId } });
  return toEventDto(e, ctx.tz, logged ? 'LOGGED' : 'PENDING');
}

async function suggestionFor(userId: string, eventId: string) {
  const ctx = await getUserContext(userId);
  const e = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId } });
  if (!e) throw notFound('Calendar event');
  const date = localDate(e.startAt, ctx.tz);
  await refreshSuggestionsForDate(userId, date);
  const s = await prisma.workSuggestion.findUnique({ where: { userId_source_sourceRef: { userId, source: 'CALENDAR', sourceRef: e.id } } });
  if (!s) throw conflict('EVENT_NOT_LOGGABLE', 'All-day or cancelled events cannot be imported as time.');
  return { s, e, date };
}

/** Accepts a meeting as a LOCAL time entry. Never touches Zoho. */
export async function acceptEvent(userId: string, eventId: string, overrides: z.infer<typeof acceptOverridesSchema>) {
  const { s } = await suggestionFor(userId, eventId);
  if (s.status === 'ACCEPTED') throw conflict('ALREADY_LOGGED', 'This meeting is already in your timesheet.');
  if (s.status === 'IGNORED') await prisma.workSuggestion.update({ where: { id: s.id }, data: { status: 'PENDING', resolvedAt: null } });
  return acceptSuggestion(userId, s.id, overrides);
}

export async function ignoreEvent(userId: string, eventId: string) {
  const { s } = await suggestionFor(userId, eventId);
  return ignoreSuggestion(userId, s.id);
}

export const eventLocalSchema = z.strictObject({
  note: z.string().max(2000).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
});

export async function updateEventLocal(userId: string, eventId: string, patch: z.infer<typeof eventLocalSchema>) {
  const e = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId } });
  if (!e) throw notFound('Calendar event');
  if (patch.projectId && !(await prisma.project.findFirst({ where: { id: patch.projectId, userId } }))) throw notFound('Project');
  await prisma.calendarEventLocal.upsert({ where: { calendarEventId: eventId }, create: { calendarEventId: eventId, ...patch }, update: patch });
  await audit(userId, 'USER', 'calendar_event.local_updated', 'CalendarEvent', eventId, { fields: Object.keys(patch) });
  return getEvent(userId, eventId);
}

export async function eventsForDate(userId: string, date: string, tz: string) {
  const { start, end } = dayRangeUtc(date, tz);
  return prisma.calendarEvent.findMany({
    where: { userId, isDeleted: false, status: { not: 'CANCELLED' }, startAt: { gte: start, lt: end } },
    include: { local: true },
    orderBy: { startAt: 'asc' },
  });
}

export const dbDate = dateToDb;
