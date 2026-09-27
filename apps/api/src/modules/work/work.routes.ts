import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { ticketHistory } from '../reports/report.service';
import { listProjects, listSprints, listWorkItems, updateWorkItemLocal, workItemLocalSchema, workItemQuerySchema } from './work.service';

export const workRoutes = Router();
workRoutes.get('/projects', async (req, res) => ok(res, await listProjects(userOf(req).id)));
workRoutes.get('/sprints', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['UPCOMING', 'ACTIVE', 'COMPLETED']).optional() }), req.query);
  ok(res, await listSprints(userOf(req).id, q.status));
});
workRoutes.get('/work-items', async (req, res) => ok(res, await listWorkItems(userOf(req).id, parse(workItemQuerySchema, req.query))));
workRoutes.get('/work-items/:id', async (req, res) => ok(res, await ticketHistory(userOf(req).id, req.params.id)));
workRoutes.patch('/work-items/:id/local', async (req, res) => ok(res, await updateWorkItemLocal(userOf(req).id, req.params.id, parse(workItemLocalSchema, req.body))));
