import { Router } from 'express';
import { z } from 'zod';
import { changePassword, login, logout, SESSION_COOKIE } from './auth.service';
import { ok, parse, userOf } from '../../lib/http';
import { cookieSecure } from '../../config/env';
import { limits } from '../../middleware/security';
import { requireAuth } from '../../middleware/auth';

export const authRoutes = Router();

authRoutes.post('/login', limits.login, async (req, res) => {
  const body = parse(z.object({ email: z.email(), password: z.string().min(1).max(200) }), req.body);
  const session = await login(body.email, body.password, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/', expires: session.expiresAt,
  });
  ok(res, { user: session.user });
});

authRoutes.post('/logout', async (req, res) => {
  await logout(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  ok(res, { loggedOut: true });
});

authRoutes.get('/me', requireAuth, (req, res) => ok(res, { user: userOf(req) }));

authRoutes.post('/password', requireAuth, limits.login, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(12).max(200) }), req.body);
  await changePassword(userOf(req).id, body.currentPassword, body.newPassword);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  ok(res, { changed: true });
});
