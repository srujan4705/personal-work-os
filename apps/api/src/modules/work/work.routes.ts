import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { ticketHistory } from '../reports/report.service';
import { listProjects, listSprints, listWorkItems, updateWorkItemLocal, workItemLocalSchema, workItemQuerySchema } from './work.service';
import {
  addManualTicket, assignExistingTicket, createManualSprint, deleteManualSprint, manualSprintSchema, manualTicketSchema,
  removeTicketFromSprint, unassignedTickets,
} from './manual-sprint.service';

export const workRoutes = Router();
workRoutes.get('/projects', async (req, res) => ok(res, await listProjects(userOf(req).id)));
workRoutes.get('/sprints', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['UPCOMING', 'ACTIVE', 'COMPLETED']).optional() }), req.query);
  ok(res, await listSprints(userOf(req).id, q.status));
});
workRoutes.get('/work-items', async (req, res) => ok(res, await listWorkItems(userOf(req).id, parse(workItemQuerySchema, req.query))));
workRoutes.get('/work-items/:id', async (req, res) => ok(res, await ticketHistory(userOf(req).id, req.params.id)));
workRoutes.patch('/work-items/:id/local', async (req, res) => ok(res, await updateWorkItemLocal(userOf(req).id, req.params.id, parse(workItemLocalSchema, req.body))));

// Manual sprints: local-only tracking for when a synced provider's sprint data is unavailable
// (e.g. Jira's board/sprint endpoints rejecting a scoped token). They show up on the same
// /sprints listing above — no separate endpoint or page for them.
workRoutes.post('/sprints/manual', async (req, res) => ok(res, await createManualSprint(userOf(req).id, parse(manualSprintSchema, req.body))));
workRoutes.delete('/sprints/manual/:id', async (req, res) => { await deleteManualSprint(userOf(req).id, req.params.id); ok(res, { deleted: true }); });
workRoutes.get('/sprints/unassigned-tickets', async (req, res) => ok(res, await unassignedTickets(userOf(req).id)));
workRoutes.post('/sprints/manual/:id/items/assign', async (req, res) => {
  const body = parse(z.object({ workItemId: z.string().min(1) }), req.body);
  await assignExistingTicket(userOf(req).id, req.params.id, body.workItemId);
  ok(res, { assigned: true });
});
workRoutes.post('/sprints/manual/:id/items/new', async (req, res) => ok(res, await addManualTicket(userOf(req).id, req.params.id, parse(manualTicketSchema, req.body))));
workRoutes.delete('/sprints/manual/:id/items/:workItemId', async (req, res) => {
  await removeTicketFromSprint(userOf(req).id, req.params.id, req.params.workItemId);
  ok(res, { removed: true });
});
