import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { forbidden } from '../lib/errors';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated routes: state-changing requests must carry a
 * custom header. Browsers cannot send it cross-site without a CORS preflight, and CORS
 * only allows APP_URL. Combined with SameSite=Lax cookies.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get('x-pwos-csrf') === '1') return next();
  next(forbidden('Missing CSRF header.'));
};

function limiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' } });
    },
  });
}

export const limits = {
  api: limiter(60_000, env.RATE_LIMIT_API_PER_MIN),
  login: limiter(15 * 60_000, env.RATE_LIMIT_LOGIN_PER_15MIN),
  assistant: limiter(60_000, env.RATE_LIMIT_ASSISTANT_PER_MIN),
  sync: limiter(60_000, env.RATE_LIMIT_SYNC_PER_MIN),
  notify: limiter(60_000, env.RATE_LIMIT_NOTIFY_PER_MIN),
  telegram: limiter(60_000, env.RATE_LIMIT_TELEGRAM_PER_MIN),
  cron: limiter(60_000, env.RATE_LIMIT_CRON_PER_MIN),
};
