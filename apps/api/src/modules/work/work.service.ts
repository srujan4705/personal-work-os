import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { dbToDate } from '../../lib/time';
import { audit } from '../audit/audit.service';
import type { Prisma } from '../../generated/prisma/client';

const DONE = /(closed|done|complete|resolved|finished)/i;
export const isDone = (w: { status: string | null; externalCompletedAt: Date | null }) => !!w.externalCompletedAt || DONE.test(w.status ?? '');

export async function listProjects(userId: string) {
  return prisma.project.findMany({ where: { userId }, orderBy: { name: 'asc' }, select: { id: true, name: true, key: true, status: true, externalUrl: true, syncedAt: true } });
}

export async function listSprints(userId: string, status?: 'UPCOMING' | 'ACTIVE' | 'COMPLETED') {
  const rows = await prisma.sprint.findMany({
    where: { userId, ...(status && { status }) },
    orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }],
    include: { project: { select: { name: true } }, _count: { select: { workItems: true } } },
    take: 100,
  });
  return rows.map((s) => ({
    id: s.id, name: s.name, goal: s.goal, status: s.status, projectName: s.project.name,
    startDate: s.startDate ? dbToDate(s.startDate) : null, endDate: s.endDate ? dbToDate(s.endDate) : null,
    workItemCount: s._count.workItems, externalUrl: s.externalUrl,
  }));
}

export async function currentSprint(userId: string) {
  return prisma.sprint.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { startDate: { sort: 'desc', nulls: 'last' } }, include: { project: { select: { name: true } } } });
}

/** Resolves a sprint by id or (case-insensitive) name; defaults to the current sprint. */
export async function resolveSprint(userId: string, ref?: string) {
  if (!ref) return currentSprint(userId);
  return prisma.sprint.findFirst({
    where: { userId, OR: [{ id: ref }, { name: { equals: ref, mode: 'insensitive' } }, { name: { contains: ref, mode: 'insensitive' } }] },
    orderBy: { startDate: { sort: 'desc', nulls: 'last' } },
    include: { project: { select: { name: true } } },
  });
}

export const workItemQuerySchema = z.object({
  q: z.string().max(200).optional(),
  assigned: z.enum(['me', 'all']).default('me'),
  state: z.enum(['open', 'done', 'all']).default('open'),
  sprintId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listWorkItems(userId: string, q: z.infer<typeof workItemQuerySchema>) {
  const where: Prisma.WorkItemWhereInput = {
    userId,
    ...(q.assigned === 'me' && { isAssignedToMe: true }),
    ...(q.sprintId && { sprintId: q.sprintId }),
    ...(q.projectId && { projectId: q.projectId }),
    ...(q.q && { OR: [{ ticketKey: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] }),
  };
  const rows = await prisma.workItem.findMany({
    where,
    include: { project: { select: { name: true } }, sprint: { select: { name: true } }, local: true },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: 500,
  });
  const filtered = rows.filter((w) => (q.state === 'all' ? true : q.state === 'done' ? isDone(w) : !isDone(w)));
  const pageRows = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const totals = await prisma.timeEntry.groupBy({ by: ['workItemId'], where: { userId, workItemId: { in: pageRows.map((r) => r.id) } }, _sum: { durationMinutes: true } });
  return {
    total: filtered.length,
    items: pageRows.map((w) => ({
      id: w.id, ticketKey: w.ticketKey, title: w.title, status: w.status, priority: w.priority, isDone: isDone(w),
      projectName: w.project?.name ?? null, sprintName: w.sprint?.name ?? null, externalUrl: w.externalUrl,
      dueDate: w.dueDate ? dbToDate(w.dueDate) : null, isAssignedToMe: w.isAssignedToMe,
      personalStatus: w.local?.personalStatus ?? null, labels: w.local?.labels ?? [],
      loggedMinutes: totals.find((t) => t.workItemId === w.id)?._sum.durationMinutes ?? 0,
      label: 'EXTERNAL' as const,
    })),
  };
}

export const workItemLocalSchema = z.strictObject({
  notes: z.string().max(8000).nullable().optional(),
  labels: z.array(z.string().min(1).max(40)).max(20).optional(),
  personalStatus: z.string().max(40).nullable().optional(),
  personalEstimateMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  reminderAt: z.iso.datetime().nullable().optional(),
});

/** Updates LOCAL-ONLY metadata. These fields are never sent to Zoho. */
export async function updateWorkItemLocal(userId: string, id: string, patch: z.infer<typeof workItemLocalSchema>) {
  const item = await prisma.workItem.findFirst({ where: { id, userId } });
  if (!item) throw notFound('Work item');
  const data = { ...patch, ...(patch.reminderAt !== undefined && { reminderAt: patch.reminderAt ? new Date(patch.reminderAt) : null }) };
  await prisma.workItemLocal.upsert({ where: { workItemId: id }, create: { workItemId: id, ...data }, update: data });
  await audit(userId, 'USER', 'work_item.local_updated', 'WorkItem', id, { fields: Object.keys(patch) });
  return { updated: true };
}
