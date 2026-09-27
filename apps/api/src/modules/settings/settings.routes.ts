import { Router } from 'express';
import { ok, parse, userOf } from '../../lib/http';
import { getUserContext, settingsPatchSchema, updateSettings } from './settings.service';

export const settingsRoutes = Router();
settingsRoutes.get('/', async (req, res) => {
  const ctx = await getUserContext(userOf(req).id);
  ok(res, { ...ctx.settings, timezone: ctx.tz, email: ctx.email, name: ctx.name });
});
settingsRoutes.patch('/', async (req, res) => {
  const user = userOf(req);
  await updateSettings(user.id, parse(settingsPatchSchema, req.body));
  const ctx = await getUserContext(user.id);
  ok(res, { ...ctx.settings, timezone: ctx.tz, email: ctx.email, name: ctx.name });
});
