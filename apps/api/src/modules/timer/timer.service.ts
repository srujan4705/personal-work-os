import { z } from 'zod';
import { ACTIVITY_TYPES } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { localDate, localTime } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { getUserContext } from '../settings/settings.service';
import { addEntry, resolveWork } from '../timesheets/timesheet.service';
import type { AuditActor } from '../../generated/prisma/enums';

export const startTimerSchema = z.strictObject({
  activityType: z.enum(ACTIVITY_TYPES),
  workItemId: z.string().max(64).nullable().optional(),
  ticket: z.string().max(64).optional(),
  description: z.string().max(1000).nullable().optional(),
});

type TimerRow = NonNullable<Awaited<ReturnType<typeof prisma.timer.findUnique>>>;

export function elapsedSeconds(t: Pick<TimerRow, 'status' | 'accumulatedSeconds' | 'segmentStartedAt'>, now = new Date()) {
  const running = t.status === 'RUNNING' && t.segmentStartedAt ? Math.floor((now.getTime() - t.segmentStartedAt.getTime()) / 1000) : 0;
  return t.accumulatedSeconds + Math.max(0, running);
}

async function withWork(t: TimerRow | null, now = new Date()) {
  if (!t) return null;
  const item = t.workItemId ? await prisma.workItem.findUnique({ where: { id: t.workItemId }, select: { ticketKey: true, title: true } }) : null;
  return { ...t, elapsedSeconds: elapsedSeconds(t, now), ticketKey: item?.ticketKey ?? null, ticketTitle: item?.title ?? null };
}

export async function getTimer(userId: string) {
  return withWork(await prisma.timer.findUnique({ where: { userId } }));
}

export async function startTimer(userId: string, input: z.infer<typeof startTimerSchema>, actor: AuditActor = 'USER', now = new Date()) {
  if (await prisma.timer.findUnique({ where: { userId } })) throw conflict('TIMER_ALREADY_RUNNING', 'A timer is already active. Stop it first.');
  const work = await resolveWork(userId, input);
  try {
    const t = await prisma.timer.create({
      data: { userId, ...work, activityType: input.activityType, description: input.description ?? null, startedAt: now, segmentStartedAt: now, status: 'RUNNING' },
    });
    await audit(userId, actor, 'timer.started', 'Timer', t.id);
    return withWork(t, now);
  } catch {
    throw conflict('TIMER_ALREADY_RUNNING', 'A timer is already active. Stop it first.');
  }
}

export async function pauseTimer(userId: string, now = new Date()) {
  const t = await prisma.timer.findUnique({ where: { userId } });
  if (!t) throw notFound('Active timer');
  if (t.status !== 'RUNNING') throw conflict('TIMER_NOT_RUNNING', 'The timer is already paused.');
  const updated = await prisma.timer.update({
    where: { userId },
    data: { status: 'PAUSED', pausedAt: now, segmentStartedAt: null, accumulatedSeconds: elapsedSeconds(t, now) },
  });
  return withWork(updated, now);
}

export async function resumeTimer(userId: string, now = new Date()) {
  const t = await prisma.timer.findUnique({ where: { userId } });
  if (!t) throw notFound('Active timer');
  if (t.status !== 'PAUSED') throw conflict('TIMER_NOT_PAUSED', 'The timer is already running.');
  return withWork(await prisma.timer.update({ where: { userId }, data: { status: 'RUNNING', pausedAt: null, segmentStartedAt: now } }), now);
}

/** Stops the timer and converts it into a DRAFT time entry on the day it started. */
export async function stopTimer(userId: string, actor: AuditActor = 'USER', now = new Date()) {
  const t = await prisma.timer.findUnique({ where: { userId } });
  if (!t) throw notFound('Active timer');
  const ctx = await getUserContext(userId);
  const seconds = elapsedSeconds(t, now);
  const minutes = Math.min(1440, Math.max(1, Math.round(seconds / 60)));
  const date = localDate(t.startedAt, ctx.tz);
  const sameDay = localDate(now, ctx.tz) === date && localTime(now, ctx.tz) > localTime(t.startedAt, ctx.tz);
  const spanMinutes = Math.round((now.getTime() - t.startedAt.getTime()) / 60000);
  const entry = await addEntry(
    userId,
    date,
    {
      workItemId: t.workItemId,
      activityType: t.activityType,
      durationMinutes: minutes,
      startTime: localTime(t.startedAt, ctx.tz),
      endTime: sameDay && spanMinutes >= minutes ? localTime(now, ctx.tz) : null,
      description: t.description,
    },
    { source: 'TIMER', actor },
  );
  await prisma.timer.delete({ where: { userId } });
  await audit(userId, actor, 'timer.stopped', 'Timer', t.id, { minutes });
  return { entry, minutes };
}
