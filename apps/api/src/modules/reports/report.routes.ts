import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import { getUserContext, today } from '../settings/settings.service';
import { dailyReport, monthlyReport, sprintReport, ticketHistory, weeklyReport } from './report.service';
import { generateRetrospective, generateStandup } from './standup.service';
import { draftText } from '../assistant/drafts.service';
import { limits } from '../../middleware/security';

export const reportRoutes = Router();
const date = z.string().regex(DATE_REGEX);

async function dateOrToday(userId: string, value: unknown) {
  return value ? parse(date, value) : today(await getUserContext(userId));
}

reportRoutes.get('/daily', async (req, res) => ok(res, await dailyReport(userOf(req).id, await dateOrToday(userOf(req).id, req.query.date))));
reportRoutes.get('/weekly', async (req, res) => ok(res, await weeklyReport(userOf(req).id, await dateOrToday(userOf(req).id, req.query.weekOf))));
reportRoutes.get('/monthly', async (req, res) => {
  const month = req.query.month ? parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), req.query.month) : (await dateOrToday(userOf(req).id, undefined)).slice(0, 7);
  ok(res, await monthlyReport(userOf(req).id, month));
});
reportRoutes.get('/sprint', async (req, res) => ok(res, await sprintReport(userOf(req).id, typeof req.query.sprint === 'string' ? req.query.sprint : undefined)));
reportRoutes.get('/ticket/:ref', async (req, res) => ok(res, await ticketHistory(userOf(req).id, req.params.ref)));
reportRoutes.get('/standup', async (req, res) => ok(res, await generateStandup(userOf(req).id, req.query.date ? parse(date, req.query.date) : undefined)));
reportRoutes.get('/retrospective', async (req, res) => ok(res, await generateRetrospective(userOf(req).id, typeof req.query.sprint === 'string' ? req.query.sprint : undefined)));

/** AI-assisted drafts (weekly summary, next-week focus, retrospective answers). Falls back to deterministic text. */
reportRoutes.post('/drafts', limits.assistant, async (req, res) => {
  const body = parse(z.object({ kind: z.enum(['weekly_summary', 'next_week_focus', 'retrospective', 'standup']), weekOf: date.optional(), sprint: z.string().max(128).optional() }), req.body);
  ok(res, await draftText(userOf(req).id, body));
});
