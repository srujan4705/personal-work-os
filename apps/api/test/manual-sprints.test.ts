import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { loginAs, seedTicket } from './helpers';

describe('manual sprints', () => {
  it('creates a sprint, mixes it into the normal /sprints listing, and computes status from dates', async () => {
    const s = await loginAs();
    const res = await s.post('/sprints/manual', { name: 'Sprint Zeta', goal: 'Ship the thing', startDate: '2020-01-01', endDate: '2020-01-14' });
    expect(res.status).toBe(200);

    const list = await s.get('/sprints');
    expect(list.status).toBe(200);
    const mine = list.body.data.find((row: { id: string }) => row.id === res.body.data.id);
    expect(mine).toMatchObject({ name: 'Sprint Zeta', provider: 'MANUAL', status: 'COMPLETED', workItemCount: 0 }); // dates are in the past
  });

  it('assigns an existing synced ticket and a brand-new manual ticket, then removes them correctly', async () => {
    const s = await loginAs();
    const ticket = await seedTicket(s.user.id, 'ER-900');
    const sprint = (await s.post('/sprints/manual', { name: 'Sprint A' })).body.data;

    expect((await s.post(`/sprints/manual/${sprint.id}/items/assign`, { workItemId: ticket.id })).status).toBe(200);
    const created = await s.post(`/sprints/manual/${sprint.id}/items/new`, { title: 'Untracked hotfix', ticketKey: 'LOCAL-1' });
    expect(created.status).toBe(200);

    let list = await s.get('/sprints');
    expect(list.body.data.find((r: { id: string }) => r.id === sprint.id).workItemCount).toBe(2);

    // Removing the SYNCED ticket just unassigns it — the ticket itself must survive.
    expect((await s.del(`/sprints/manual/${sprint.id}/items/${ticket.id}`)).status).toBe(200);
    expect(await prisma.workItem.findUnique({ where: { id: ticket.id } })).not.toBeNull();
    expect((await prisma.workItem.findUnique({ where: { id: ticket.id } }))?.sprintId).toBeNull();

    // Removing the MANUAL-only ticket deletes it outright — it had no existence outside this sprint.
    expect((await s.del(`/sprints/manual/${sprint.id}/items/${created.body.data.id}`)).status).toBe(200);
    expect(await prisma.workItem.findUnique({ where: { id: created.body.data.id } })).toBeNull();

    list = await s.get('/sprints');
    expect(list.body.data.find((r: { id: string }) => r.id === sprint.id).workItemCount).toBe(0);
  });

  it('deleting a sprint keeps synced tickets but deletes manual-only ones with it', async () => {
    const s = await loginAs();
    const ticket = await seedTicket(s.user.id, 'ER-901');
    const sprint = (await s.post('/sprints/manual', { name: 'Sprint B' })).body.data;
    await s.post(`/sprints/manual/${sprint.id}/items/assign`, { workItemId: ticket.id });
    const created = await s.post(`/sprints/manual/${sprint.id}/items/new`, { title: 'Only in this sprint' });

    expect((await s.del(`/sprints/manual/${sprint.id}`)).status).toBe(200);
    expect(await prisma.sprint.findUnique({ where: { id: sprint.id } })).toBeNull();
    expect(await prisma.workItem.findUnique({ where: { id: created.body.data.id } })).toBeNull();
    const survivor = await prisma.workItem.findUnique({ where: { id: ticket.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.sprintId).toBeNull();
  });

  it('refuses to edit a synced (non-manual) sprint, and refuses cross-user access', async () => {
    const s = await loginAs();
    const project = await prisma.project.create({ data: { userId: s.user.id, provider: 'ZOHO', externalId: 'p1', name: 'Proj', syncedAt: new Date() } });
    const synced = await prisma.sprint.create({
      data: { userId: s.user.id, provider: 'ZOHO', externalId: 'ext-1', name: 'Real sprint', status: 'ACTIVE', syncedAt: new Date(), projectId: project.id },
    });
    expect((await s.del(`/sprints/manual/${synced.id}`)).status).toBe(403);

    const other = await loginAs();
    const mine = (await s.post('/sprints/manual', { name: 'Private' })).body.data;
    expect((await other.del(`/sprints/manual/${mine.id}`)).status).toBe(404);
  });

  it('lists tickets with no sprint yet as candidates to assign', async () => {
    const s = await loginAs();
    const ticket = await seedTicket(s.user.id, 'ER-902');
    const res = await s.get('/sprints/unassigned-tickets');
    expect(res.body.data.map((t: { id: string }) => t.id)).toContain(ticket.id);
  });
});
