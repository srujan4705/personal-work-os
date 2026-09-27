import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { limits } from '../../middleware/security';
import { notifications } from '../notifications/notification.service';
import { runScheduledJobs } from './scheduler';

const querySchema = z.object({ scope: z.enum(['all', 'notifications', 'sync']).default('all') });

const digest = (v: string) => createHash('sha256').update(v).digest();

/** Constant-time check of "Authorization: Bearer <CRON_SECRET>". */
function authorized(header: string | undefined): boolean {
  const secret = env.CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

/**
 * External trigger for scheduled jobs (for hosts that sleep, e.g. Render Free).
 * Authenticated by a shared secret, never by cookies, so it is mounted before the CSRF guard.
 * Disabled (404) unless CRON_SECRET is set.
 */
export const cronRoutes = Router();

cronRoutes.post('/cron/tick', limits.cron, async (req, res, next) => {
  try {
    if (!env.CRON_SECRET) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
      return;
    }
    if (!authorized(req.get('authorization'))) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron credentials.' } });
      return;
    }
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'scope must be all, notifications or sync.' } });
      return;
    }
    const { scope } = parsed.data;
    const started = Date.now();
    const result = await runScheduledJobs(notifications(), new Date(), scope);
    const durationMs = Date.now() - started;
    logger.info({ scope, durationMs, skipped: !result }, 'cron.tick');
    res.json({ success: true, data: { scope, status: result ? 'completed' : 'already_running', users: result?.users ?? 0, durationMs } });
  } catch (err) {
    next(err);
  }
});
