import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { forbidden, notFound } from '../../lib/errors';
import { dateToDb } from '../../lib/time';
import { audit } from '../audit/audit.service';

const MANUAL_PROJECT_EXTERNAL_ID = 'manual';

/** One synthetic project per user that every manually-created sprint hangs off — Sprint.projectId
 * is required by the schema (every other provider's sprints belong to a real project), and manual
 * sprints need somewhere to attach without inventing a "nullable for this one provider" special case. */
async function ensureManualProject(userId: string) {
  return prisma.project.upsert({
    where: { userId_provider_externalId: { userId, provider: 'MANUAL', externalId: MANUAL_PROJECT_EXTERNAL_ID } },
    create: { userId, provider: 'MANUAL', externalId: MANUAL_PROJECT_EXTERNAL_ID, name: 'Manual', syncedAt: new Date() },
    update: {},
  });
}

function computeStatus(startDate?: string, endDate?: string): 'UPCOMING' | 'ACTIVE' | 'COMPLETED' {
  const today = new Date().toISOString().slice(0, 10);
  if (startDate && today < startDate) return 'UPCOMING';
  if (endDate && today > endDate) return 'COMPLETED';
  return 'ACTIVE';
}

export const manualSprintSchema = z.object({
  name: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(2000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function createManualSprint(userId: string, input: z.infer<typeof manualSprintSchema>) {
  const project = await ensureManualProject(userId);
  const sprint = await prisma.sprint.create({
    data: {
      userId, projectId: project.id, provider: 'MANUAL', externalId: randomUUID(),
      name: input.name, goal: input.goal || null,
      status: computeStatus(input.startDate, input.endDate),
      startDate: input.startDate ? dateToDb(input.startDate) : null,
      endDate: input.endDate ? dateToDb(input.endDate) : null,
      syncedAt: new Date(),
    },
  });
  await audit(userId, 'USER', 'sprint.manual.created', 'Sprint', sprint.id, { name: sprint.name });
  return sprint;
}

async function ownedManualSprint(userId: string, sprintId: string) {
  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!sprint || sprint.userId !== userId) throw notFound('Sprint');
  if (sprint.provider !== 'MANUAL') throw forbidden('Only manually-created sprints can be edited — synced sprints are read-only.');
  return sprint;
}

export async function deleteManualSprint(userId: string, sprintId: string) {
  await ownedManualSprint(userId, sprintId);
  // WorkItem.sprintId → onDelete: SetNull, so synced tickets just get unassigned, never deleted.
  // Manually-typed tickets (provider MANUAL) only existed for this sprint, so they go with it.
  await prisma.workItem.deleteMany({ where: { userId, sprintId, provider: 'MANUAL' } });
  await prisma.sprint.delete({ where: { id: sprintId } });
  await audit(userId, 'USER', 'sprint.manual.deleted', 'Sprint', sprintId);
}

/** Assigns an already-synced ticket (Jira, Zoho, whatever) to a manual sprint. The ticket itself
 * is untouched otherwise — a later sync can still update its title/status/etc. normally; only
 * this app's own sprintId pointer changes, nothing is written back to the original provider. */
export async function assignExistingTicket(userId: string, sprintId: string, workItemId: string) {
  await ownedManualSprint(userId, sprintId);
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.userId !== userId) throw notFound('Ticket');
  await prisma.workItem.update({ where: { id: workItemId }, data: { sprintId } });
  await audit(userId, 'USER', 'sprint.manual.item_assigned', 'Sprint', sprintId, { workItemId });
}

export const manualTicketSchema = z.object({
  title: z.string().trim().min(1).max(500),
  ticketKey: z.string().trim().max(64).optional(),
});

/** Creates a brand-new ticket that exists only inside this manual sprint — for work that was
 * never in Jira to begin with, not a substitute for the real ticket-tracking system. */
export async function addManualTicket(userId: string, sprintId: string, input: z.infer<typeof manualTicketSchema>) {
  const sprint = await ownedManualSprint(userId, sprintId);
  const item = await prisma.workItem.create({
    data: {
      userId, provider: 'MANUAL', externalId: randomUUID(), sprintId, projectId: sprint.projectId,
      title: input.title, ticketKey: input.ticketKey || null, isAssignedToMe: true, syncedAt: new Date(),
    },
  });
  await audit(userId, 'USER', 'sprint.manual.item_created', 'Sprint', sprintId, { workItemId: item.id });
  return item;
}

export async function removeTicketFromSprint(userId: string, sprintId: string, workItemId: string) {
  await ownedManualSprint(userId, sprintId);
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item || item.userId !== userId || item.sprintId !== sprintId) throw notFound('Ticket');
  if (item.provider === 'MANUAL') await prisma.workItem.delete({ where: { id: workItemId } });
  else await prisma.workItem.update({ where: { id: workItemId }, data: { sprintId: null } });
  await audit(userId, 'USER', 'sprint.manual.item_removed', 'Sprint', sprintId, { workItemId });
}

/** Tickets not yet in any sprint — the pool you'd pick from to assign into a manual one. */
export async function unassignedTickets(userId: string, limit = 100) {
  return prisma.workItem.findMany({
    where: { userId, sprintId: null },
    orderBy: { syncedAt: 'desc' },
    take: limit,
    select: { id: true, ticketKey: true, title: true, provider: true },
  });
}
