import pino from 'pino';
import { env } from '../config/env';

/** Structured logger. Secrets are redacted by path; never log raw tokens anyway. */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-telegram-bot-api-secret-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.secret',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
