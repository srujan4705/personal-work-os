import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { ok, userOf } from '../../lib/http';
import { limits } from '../../middleware/security';
import { requireAuth } from '../../middleware/auth';
import { createLinkCode, handleUpdate, linkStatus, unlink } from './telegram.service';
import type { TelegramUpdate } from './telegram.api';

/** Public webhook (no cookie auth, no CSRF header) — authenticated by Telegram's secret token header. */
export const telegramWebhookRoutes = Router();
telegramWebhookRoutes.post('/webhook', limits.telegram, async (req, res) => {
  const given = Buffer.from(req.get('x-telegram-bot-api-secret-token') ?? '');
  const expected = Buffer.from(env.TELEGRAM_WEBHOOK_SECRET ?? '');
  if (env.TELEGRAM_MODE !== 'webhook' || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret.' } });
    return;
  }
  res.json({ ok: true }); // acknowledge fast; Telegram retries slow webhooks
  handleUpdate(req.body as TelegramUpdate).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, 'telegram.update_failed'));
});

export const telegramRoutes = Router();
telegramRoutes.use(requireAuth);
telegramRoutes.get('/status', async (req, res) => ok(res, await linkStatus(userOf(req).id)));
telegramRoutes.post('/link-code', async (req, res) => ok(res, await createLinkCode(userOf(req).id), 201));
telegramRoutes.delete('/link', async (req, res) => ok(res, await unlink(userOf(req).id)));
