import { Router } from 'express';
import { z } from 'zod';
import { parse, userOf } from '../../lib/http';
import { addDays, DATE_REGEX, startOfIsoWeek } from '../../lib/time';
import { fullExport, timeEntriesCsv } from './export.service';
import { audit } from '../audit/audit.service';

export const exportRoutes = Router();
const date = z.string().regex(DATE_REGEX);
const bigint = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

exportRoutes.get('/time-entries.csv', async (req, res) => {
  const q = parse(z.object({ from: date, to: date }), req.query);
  res.type('text/csv').attachment(`time-entries-${q.from}-to-${q.to}.csv`).send(await timeEntriesCsv(userOf(req).id, q.from, q.to));
});

exportRoutes.get('/weekly.csv', async (req, res) => {
  const q = parse(z.object({ weekOf: date }), req.query);
  const from = startOfIsoWeek(q.weekOf);
  res.type('text/csv').attachment(`week-${from}.csv`).send(await timeEntriesCsv(userOf(req).id, from, addDays(from, 6)));
});

exportRoutes.get('/all.json', async (req, res) => {
  const user = userOf(req);
  await audit(user.id, 'USER', 'data.exported', 'User', user.id);
  res.type('application/json').attachment(`personal-work-os-export-${new Date().toISOString().slice(0, 10)}.json`).send(JSON.stringify(await fullExport(user.id), bigint, 2));
});
