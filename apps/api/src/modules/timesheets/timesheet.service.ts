import { z } from 'zod';
import { ACTIVITY_TYPES } from '@pwos/shared';
import { prisma, type Tx } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError, badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { addDays, dateToDb, dbToDate, eachDate, HM_REGEX, isoWeekday, localDate, localTime, startOfIsoWeek, zonedTimeToUtc } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getUserContext, isWorkingDay, type UserContext } from '../settings/settings.service';
import { validateEntries } from './timesheet.validation';
import type { AuditActor, DayType, ExternalProvider, TimeEntrySource } from '../../generated/prisma/enums';

const hm = z.string().regex(HM_REGEX, 'Expected HH:mm');

export const entryInputSchema = z.strictObject({
  workItemId: z.string().max(64).nullable().optional(),
  ticket: z.string().max(64).optional(),
  activityType: z.enum(ACTIVITY_TYPES),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  startTime: hm.nullable().optional(),
  endTime: hm.nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});
export type EntryInput = z.infer<typeof entryInputSchema>;

export const entryPatchSchema = entryInputSchema.partial().extend({ version: z.number().int().optional() });
export type EntryPatch = z.infer<typeof entryPatchSchema>;

export interface EntryMeta {
  source: TimeEntrySource;
  actor: AuditActor;
  externalProvider?: ExternalProvider | null;
  externalId?: string | null;
}

const entryInclude = {
  workItem: { select: { id: true, ticketKey: true, title: true, externalUrl: true } },
  project: { select: { id: true, name: true } },
} as const;

/** Resolve a ticket key or work item id to local ids. */
export async function resolveWork(userId: string, ref: { workItemId?: string | null; ticket?: string }) {
  const key = ref.workItemId ?? ref.ticket;
  if (!key) return { workItemId: null, projectId: null, sprintId: null };
  const item = await prisma.workItem.findFirst({
    where: { userId, OR: [{ id: key }, { ticketKey: { equals: key, mode: 'insensitive' } }] },
    select: { id: true, projectId: true, sprintId: true },
  });
  if (!item) throw new AppError(404, 'TICKET_NOT_FOUND', `Ticket ${key} was not found in your synced work items.`);
  return { workItemId: item.id, projectId: item.projectId, sprintId: item.sprintId };
}

function computeTimes(date: string, tz: string, input: { durationMinutes?: number; startTime?: string | null; endTime?: string | null }) {
  const { startTime, endTime } = input;
  if (endTime && !startTime) throw badRequest('INVALID_TIME_RANGE', 'An end time needs a start time.');
  if (startTime && endTime) {
    const start = zonedTimeToUtc(date, startTime, tz);
    const end = zonedTimeToUtc(date, endTime, tz);
    if (end <= start) throw badRequest('INVALID_TIME_RANGE', 'End time must be after start time.');
    const span = Math.round((end.getTime() - start.getTime()) / 60000);
    const duration = input.durationMinutes ?? span;
    if (duration > span) throw badRequest('DURATION_EXCEEDS_RANGE', 'Duration is longer than the start–end range.');
    return { startTime: start, endTime: end, durationMinutes: duration };
  }
  if (!input.durationMinutes) throw badRequest('DURATION_REQUIRED', 'Provide a duration or a start and end time.');
  if (startTime) {
    const start = zonedTimeToUtc(date, startTime, tz);
    return { startTime: start, endTime: new Date(start.getTime() + input.durationMinutes * 60000), durationMinutes: input.durationMinutes };
  }
  return { startTime: null, endTime: null, durationMinutes: input.durationMinutes };
}

async function expectedFor(ctx: UserContext, date: string): Promise<{ expected: number; dayType: DayType }> {
  const [holiday, leave] = await Promise.all([
    prisma.holiday.findUnique({ where: { userId_date: { userId: ctx.userId, date: dateToDb(date) } } }),
    prisma.leaveRecord.findUnique({ where: { userId_date: { userId: ctx.userId, date: dateToDb(date) } } }),
  ]);
  if (holiday) return { expected: 0, dayType: 'HOLIDAY' };
  if (leave?.kind === 'FULL_DAY') return { expected: 0, dayType: 'LEAVE' };
  const base = isWorkingDay(ctx.settings, isoWeekday(date)) ? ctx.settings.expectedDailyMinutes : 0;
  if (leave?.kind === 'HALF_DAY') return { expected: Math.round(base / 2), dayType: 'HALF_DAY' };
  return { expected: base, dayType: 'WORKDAY' };
}

export async function ensureTimesheet(userId: string, date: string, ctx?: UserContext) {
  const existing = await prisma.dailyTimesheet.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } } });
  if (existing) return existing;
  const c = ctx ?? (await getUserContext(userId));
  const { expected, dayType } = await expectedFor(c, date);
  try {
    return await prisma.dailyTimesheet.create({ data: { userId, date: dateToDb(date), expectedMinutes: expected, dayType } });
  } catch (err) {
    if (isUniqueViolation(err)) return prisma.dailyTimesheet.findUniqueOrThrow({ where: { userId_date: { userId, date: dateToDb(date) } } });
    throw err;
  }
}

function assertEditable(ts: { status: string; date: Date }) {
  if (ts.status !== 'DRAFT') {
    throw conflict('TIMESHEET_NOT_EDITABLE', `The timesheet for ${dbToDate(ts.date)} is ${ts.status.toLowerCase()}. Reopen it to make changes.`);
  }
}

async function recomputeLogged(tx: Tx, timesheetId: string) {
  const agg = await tx.timeEntry.aggregate({ where: { dailyTimesheetId: timesheetId }, _sum: { durationMinutes: true } });
  await tx.dailyTimesheet.update({ where: { id: timesheetId }, data: { loggedMinutes: agg._sum.durationMinutes ?? 0, version: { increment: 1 } } });
}

export async function getTimesheet(userId: string, date: string) {
  const ctx = await getUserContext(userId);
  const ts = await ensureTimesheet(userId, date, ctx);
  const entries = await prisma.timeEntry.findMany({
    where: { dailyTimesheetId: ts.id },
    include: entryInclude,
    orderBy: [{ startTime: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
  const issues = validateEntries(entries, {
    tz: ctx.tz, workStartTime: ctx.settings.workStartTime, workEndTime: ctx.settings.workEndTime, expectedMinutes: ts.expectedMinutes,
  });
  return {
    timesheet: { ...ts, date: dbToDate(ts.date) },
    entries: entries.map((e) => toEntryDto(e, ctx.tz)),
    issues,
    summary: { loggedMinutes: ts.loggedMinutes, expectedMinutes: ts.expectedMinutes, remainingMinutes: Math.max(0, ts.expectedMinutes - ts.loggedMinutes) },
  };
}

type EntryWithRelations = Awaited<ReturnType<typeof prisma.timeEntry.findMany<{ include: typeof entryInclude }>>>[number];

export function toEntryDto(e: EntryWithRelations, tz: string) {
  return {
    id: e.id,
    date: e.startTime ? localDate(e.startTime, tz) : null,
    workItemId: e.workItemId,
    ticketKey: e.workItem?.ticketKey ?? null,
    ticketTitle: e.workItem?.title ?? null,
    ticketUrl: e.workItem?.externalUrl ?? null,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    sprintId: e.sprintId,
    activityType: e.activityType,
    durationMinutes: e.durationMinutes,
    startTime: e.startTime ? localTime(e.startTime, tz) : null,
    endTime: e.endTime ? localTime(e.endTime, tz) : null,
    startAt: e.startTime,
    endAt: e.endTime,
    description: e.description,
    source: e.source,
    label: 'CONFIRMED' as const,
    version: e.version,
  };
}

export async function addEntry(userId: string, date: string, input: EntryInput, meta: EntryMeta) {
  const ctx = await getUserContext(userId);
  const ts = await ensureTimesheet(userId, date, ctx);
  assertEditable(ts);
  const work = await resolveWork(userId, input);
  const times = computeTimes(date, ctx.tz, input);
  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.timeEntry.create({
      data: {
        userId, dailyTimesheetId: ts.id, ...work, ...times,
        activityType: input.activityType,
        description: input.description ?? null,
        source: meta.source,
        externalProvider: meta.externalProvider ?? null,
        externalId: meta.externalId ?? null,
      },
      include: entryInclude,
    });
    await recomputeLogged(tx, ts.id);
    return e;
  });
  await audit(userId, meta.actor, 'time_entry.created', 'TimeEntry', entry.id, { date, minutes: entry.durationMinutes, source: meta.source });
  return toEntryDto(entry, ctx.tz);
}

async function loadOwnedEntry(userId: string, id: string) {
  const entry = await prisma.timeEntry.findFirst({ where: { id, userId }, include: { timesheet: true } });
  if (!entry) throw notFound('Time entry');
  return entry;
}

/**
 * Rules: changing start/end without a duration recomputes duration from the span;
 * changing only the duration of a timed entry moves its end time.
 */
function nextTimes(
  entry: { startTime: Date | null; endTime: Date | null; durationMinutes: number },
  patch: EntryPatch,
  tz: string,
) {
  const start = patch.startTime !== undefined ? patch.startTime : entry.startTime ? localTime(entry.startTime, tz) : null;
  let end = patch.endTime !== undefined ? patch.endTime : entry.endTime ? localTime(entry.endTime, tz) : null;
  if (patch.durationMinutes !== undefined && patch.endTime === undefined) end = null;
  const durationMinutes = patch.durationMinutes ?? (start && end ? undefined : entry.durationMinutes);
  return { startTime: start, endTime: end, durationMinutes };
}

export async function updateEntry(userId: string, id: string, patch: EntryPatch, actor: AuditActor = 'USER') {
  const ctx = await getUserContext(userId);
  const entry = await loadOwnedEntry(userId, id);
  assertEditable(entry.timesheet);
  if (patch.version !== undefined && patch.version !== entry.version) {
    throw conflict('STALE_ENTRY', 'This entry was changed elsewhere. Reload and try again.');
  }
  const date = dbToDate(entry.timesheet.date);
  const work = patch.workItemId !== undefined || patch.ticket !== undefined ? await resolveWork(userId, patch) : {};
  const times = patch.startTime !== undefined || patch.endTime !== undefined || patch.durationMinutes !== undefined
    ? computeTimes(date, ctx.tz, nextTimes(entry, patch, ctx.tz))
    : {};
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.timeEntry.updateMany({
      where: { id, version: entry.version },
      data: {
        ...work, ...times,
        ...(patch.activityType && { activityType: patch.activityType }),
        ...(patch.description !== undefined && { description: patch.description }),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw conflict('STALE_ENTRY', 'This entry was changed elsewhere. Reload and try again.');
    await recomputeLogged(tx, entry.dailyTimesheetId);
    return tx.timeEntry.findUniqueOrThrow({ where: { id }, include: entryInclude });
  });
  await audit(userId, actor, 'time_entry.updated', 'TimeEntry', id, { fields: Object.keys(patch) });
  return toEntryDto(updated, ctx.tz);
}

export async function deleteEntry(userId: string, id: string, actor: AuditActor = 'USER') {
  const entry = await loadOwnedEntry(userId, id);
  assertEditable(entry.timesheet);
  await prisma.$transaction(async (tx) => {
    await tx.workSuggestion.updateMany({ where: { timeEntryId: id }, data: { status: 'PENDING', timeEntryId: null, resolvedAt: null } });
    await tx.timeEntry.delete({ where: { id } });
    await recomputeLogged(tx, entry.dailyTimesheetId);
  });
  await audit(userId, actor, 'time_entry.deleted', 'TimeEntry', id, { minutes: entry.durationMinutes });
  return { deleted: true };
}

export async function splitEntry(userId: string, id: string, firstMinutes: number) {
  const entry = await loadOwnedEntry(userId, id);
  assertEditable(entry.timesheet);
  if (firstMinutes <= 0 || firstMinutes >= entry.durationMinutes) {
    throw badRequest('INVALID_SPLIT', `Split point must be between 1 and ${entry.durationMinutes - 1} minutes.`);
  }
  const splitAt = entry.startTime ? new Date(entry.startTime.getTime() + firstMinutes * 60000) : null;
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({ where: { id }, data: { durationMinutes: firstMinutes, endTime: splitAt ?? entry.endTime, version: { increment: 1 } } });
    await tx.timeEntry.create({
      data: {
        userId, dailyTimesheetId: entry.dailyTimesheetId, workItemId: entry.workItemId, projectId: entry.projectId, sprintId: entry.sprintId,
        activityType: entry.activityType, description: entry.description, source: 'MANUAL',
        durationMinutes: entry.durationMinutes - firstMinutes, startTime: splitAt, endTime: splitAt ? entry.endTime : null,
      },
    });
    await recomputeLogged(tx, entry.dailyTimesheetId);
  });
  await audit(userId, 'USER', 'time_entry.split', 'TimeEntry', id, { firstMinutes });
  return getTimesheet(userId, dbToDate(entry.timesheet.date));
}

export async function mergeEntries(userId: string, ids: string[]) {
  const entries = await prisma.timeEntry.findMany({ where: { id: { in: ids }, userId }, include: { timesheet: true }, orderBy: { createdAt: 'asc' } });
  if (entries.length !== ids.length || entries.length < 2) throw badRequest('INVALID_MERGE', 'Select at least two of your entries to merge.');
  const [first, ...rest] = entries as [(typeof entries)[number], ...typeof entries];
  if (rest.some((e) => e.dailyTimesheetId !== first.dailyTimesheetId)) throw badRequest('INVALID_MERGE', 'Entries must be on the same day.');
  assertEditable(first.timesheet);
  const allTimed = entries.every((e) => e.startTime && e.endTime);
  const descriptions = [...new Set(entries.map((e) => e.description?.trim()).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.deleteMany({ where: { id: { in: rest.map((e) => e.id) } } });
    await tx.timeEntry.update({
      where: { id: first.id },
      data: {
        durationMinutes: Math.min(1440, entries.reduce((s, e) => s + e.durationMinutes, 0)),
        startTime: allTimed ? new Date(Math.min(...entries.map((e) => e.startTime!.getTime()))) : null,
        endTime: allTimed ? new Date(Math.max(...entries.map((e) => e.endTime!.getTime()))) : null,
        description: descriptions.join('; ') || null,
        version: { increment: 1 },
      },
    });
    await recomputeLogged(tx, first.dailyTimesheetId);
  });
  await audit(userId, 'USER', 'time_entry.merged', 'TimeEntry', first.id, { merged: ids.length });
  return getTimesheet(userId, dbToDate(first.timesheet.date));
}

export async function submitTimesheet(userId: string, date: string, note: string | undefined, actor: AuditActor = 'USER') {
  const { timesheet, issues } = await getTimesheet(userId, date);
  if (timesheet.status !== 'DRAFT') throw conflict('ALREADY_SUBMITTED', `The timesheet for ${date} is already ${timesheet.status.toLowerCase()}.`);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw badRequest('TIMESHEET_HAS_ERRORS', `Fix ${errors.length} error(s) before submitting.`);
  const updated = await prisma.dailyTimesheet.update({
    where: { id: timesheet.id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), submissionNote: note ?? null, version: { increment: 1 } },
  });
  await audit(userId, actor, 'timesheet.submitted', 'DailyTimesheet', updated.id, { date, loggedMinutes: updated.loggedMinutes });
  logger.info({ userId, date }, 'timesheet.submitted');
  return getTimesheet(userId, date);
}

export async function reopenTimesheet(userId: string, date: string) {
  const ctx = await getUserContext(userId);
  if (!ctx.settings.allowTimesheetReopen) throw forbidden('Reopening submitted timesheets is disabled in Settings.');
  const ts = await ensureTimesheet(userId, date, ctx);
  if (ts.status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', `Only submitted timesheets can be reopened (this one is ${ts.status.toLowerCase()}).`);
  await prisma.dailyTimesheet.update({ where: { id: ts.id }, data: { status: 'DRAFT', submittedAt: null, version: { increment: 1 } } });
  await audit(userId, 'USER', 'timesheet.reopened', 'DailyTimesheet', ts.id, { date });
  return getTimesheet(userId, date);
}

export async function setDayType(userId: string, date: string, dayType: DayType, note: string | undefined, actor: AuditActor = 'USER') {
  const ctx = await getUserContext(userId);
  const ts = await ensureTimesheet(userId, date, ctx);
  assertEditable(ts);
  const key = { userId_date: { userId, date: dateToDb(date) } };
  await prisma.$transaction(async (tx) => {
    await tx.leaveRecord.deleteMany({ where: { userId, date: dateToDb(date) } });
    await tx.holiday.deleteMany({ where: { userId, date: dateToDb(date) } });
    if (dayType === 'LEAVE' || dayType === 'HALF_DAY') {
      await tx.leaveRecord.upsert({ where: key, create: { userId, date: dateToDb(date), kind: dayType === 'LEAVE' ? 'FULL_DAY' : 'HALF_DAY', note: note ?? null }, update: {} });
    }
    if (dayType === 'HOLIDAY') await tx.holiday.upsert({ where: key, create: { userId, date: dateToDb(date), name: note ?? 'Holiday' }, update: {} });
  });
  const { expected } = await expectedFor(ctx, date);
  await prisma.dailyTimesheet.update({ where: { id: ts.id }, data: { dayType, expectedMinutes: expected, version: { increment: 1 } } });
  await audit(userId, actor, 'timesheet.day_type_changed', 'DailyTimesheet', ts.id, { date, dayType });
  return getTimesheet(userId, date);
}

/** Week overview without creating timesheet rows. */
export async function getWeek(userId: string, weekOf: string) {
  const ctx = await getUserContext(userId);
  const from = startOfIsoWeek(weekOf);
  const days = eachDate(from, addDays(from, 6));
  const sheets = await prisma.dailyTimesheet.findMany({ where: { userId, date: { gte: dateToDb(days[0]!), lte: dateToDb(days[6]!) } } });
  return {
    from, to: days[6],
    days: days.map((date) => {
      const ts = sheets.find((s) => dbToDate(s.date) === date);
      const expected = ts?.expectedMinutes ?? (isWorkingDay(ctx.settings, isoWeekday(date)) ? ctx.settings.expectedDailyMinutes : 0);
      return { date, loggedMinutes: ts?.loggedMinutes ?? 0, expectedMinutes: expected, status: ts?.status ?? 'NOT_STARTED', dayType: ts?.dayType ?? 'WORKDAY' };
    }),
  };
}

export async function recentTickets(userId: string, limit = 8) {
  const rows = await prisma.timeEntry.findMany({
    where: { userId, workItemId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { workItem: { select: { id: true, ticketKey: true, title: true } } },
  });
  const seen = new Map<string, { id: string; ticketKey: string | null; title: string }>();
  for (const r of rows) if (r.workItem && !seen.has(r.workItem.id)) seen.set(r.workItem.id, r.workItem);
  return [...seen.values()].slice(0, limit);
}
