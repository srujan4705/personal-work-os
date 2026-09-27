import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import {
  addEntry, deleteEntry, entryInputSchema, entryPatchSchema, getTimesheet, getWeek, mergeEntries, recentTickets,
  reopenTimesheet, setDayType, splitEntry, submitTimesheet, updateEntry,
} from './timesheet.service';
import { completeDay } from '../dashboard/close-out.service';

export const timesheetRoutes = Router();
const dateParam = z.string().regex(DATE_REGEX, 'Expected YYYY-MM-DD');

timesheetRoutes.get('/recent-tickets', async (req, res) => ok(res, await recentTickets(userOf(req).id)));

timesheetRoutes.get('/week/:date', async (req, res) => ok(res, await getWeek(userOf(req).id, parse(dateParam, req.params.date))));

timesheetRoutes.get('/:date', async (req, res) => ok(res, await getTimesheet(userOf(req).id, parse(dateParam, req.params.date))));

timesheetRoutes.post('/:date/entries', async (req, res) => {
  const date = parse(dateParam, req.params.date);
  ok(res, await addEntry(userOf(req).id, date, parse(entryInputSchema, req.body), { source: 'MANUAL', actor: 'USER' }), 201);
});

timesheetRoutes.patch('/:date/entries/:id', async (req, res) => {
  ok(res, await updateEntry(userOf(req).id, req.params.id, parse(entryPatchSchema, req.body)));
});

timesheetRoutes.delete('/:date/entries/:id', async (req, res) => ok(res, await deleteEntry(userOf(req).id, req.params.id)));

timesheetRoutes.post('/:date/entries/:id/split', async (req, res) => {
  const body = parse(z.object({ firstMinutes: z.number().int().min(1) }), req.body);
  ok(res, await splitEntry(userOf(req).id, req.params.id, body.firstMinutes));
});

timesheetRoutes.post('/:date/entries/merge', async (req, res) => {
  const body = parse(z.object({ ids: z.array(z.string()).min(2).max(20) }), req.body);
  ok(res, await mergeEntries(userOf(req).id, body.ids));
});

timesheetRoutes.post('/:date/submit', async (req, res) => {
  const body = parse(z.object({ note: z.string().max(1000).optional() }), req.body ?? {});
  ok(res, await submitTimesheet(userOf(req).id, parse(dateParam, req.params.date), body.note));
});

timesheetRoutes.post('/:date/reopen', async (req, res) => ok(res, await reopenTimesheet(userOf(req).id, parse(dateParam, req.params.date))));

timesheetRoutes.post('/:date/day-type', async (req, res) => {
  const body = parse(z.object({ dayType: z.enum(['WORKDAY', 'LEAVE', 'HOLIDAY', 'HALF_DAY']), note: z.string().max(200).optional() }), req.body);
  ok(res, await setDayType(userOf(req).id, parse(dateParam, req.params.date), body.dayType, body.note));
});

timesheetRoutes.post('/:date/complete-day', async (req, res) => {
  const body = parse(
    z.object({
      accomplished: z.string().max(4000).optional(),
      pending: z.string().max(4000).optional(),
      blockers: z.string().max(4000).optional(),
      submissionNote: z.string().max(1000).optional(),
    }),
    req.body ?? {},
  );
  ok(res, await completeDay(userOf(req).id, parse(dateParam, req.params.date), body));
});
