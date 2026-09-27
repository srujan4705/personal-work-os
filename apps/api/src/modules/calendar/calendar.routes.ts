import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import { acceptOverridesSchema } from '../suggestions/suggestion.service';
import { acceptEvent, eventLocalSchema, getEvent, ignoreEvent, listEvents, updateEventLocal } from './calendar.service';

export const calendarRoutes = Router();
const date = z.string().regex(DATE_REGEX);

calendarRoutes.get('/events', async (req, res) => {
  const q = parse(z.object({ from: date, to: date }), req.query);
  ok(res, await listEvents(userOf(req).id, q.from, q.to));
});
calendarRoutes.get('/events/:id', async (req, res) => ok(res, await getEvent(userOf(req).id, req.params.id)));
calendarRoutes.patch('/events/:id/local', async (req, res) => ok(res, await updateEventLocal(userOf(req).id, req.params.id, parse(eventLocalSchema, req.body))));
calendarRoutes.post('/events/:id/accept', async (req, res) => ok(res, await acceptEvent(userOf(req).id, req.params.id, parse(acceptOverridesSchema, req.body ?? {})), 201));
calendarRoutes.post('/events/:id/ignore', async (req, res) => ok(res, await ignoreEvent(userOf(req).id, req.params.id)));
