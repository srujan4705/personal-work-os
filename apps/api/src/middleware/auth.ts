import type { RequestHandler } from 'express';
import { SESSION_COOKIE, userFromSession } from '../modules/auth/auth.service';
import { unauthorized } from '../lib/errors';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await userFromSession(req.cookies?.[SESSION_COOKIE]);
  if (!user) throw unauthorized();
  req.user = user;
  next();
};
