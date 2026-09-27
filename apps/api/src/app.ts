import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import { env, trustProxySetting } from './config/env';
import { logger } from './lib/logger';
import { apiNotFound, errorMiddleware } from './lib/errors';
import { requireAuth } from './middleware/auth';
import { csrfGuard, limits } from './middleware/security';
import { healthRoutes } from './modules/health/health.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { timesheetRoutes } from './modules/timesheets/timesheet.routes';
import { timerRoutes } from './modules/timer/timer.routes';
import { journalRoutes } from './modules/journal/journal.routes';
import { calendarRoutes } from './modules/calendar/calendar.routes';
import { workRoutes } from './modules/work/work.routes';
import { suggestionRoutes } from './modules/suggestions/suggestion.routes';
import { integrationRoutes, syncRoutes } from './modules/sync/sync.routes';
import { reportRoutes } from './modules/reports/report.routes';
import { exportRoutes } from './modules/exports/export.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { notificationRoutes } from './modules/notifications/notification.routes';
import { assistantRoutes } from './modules/assistant/assistant.routes';
import { telegramRoutes, telegramWebhookRoutes } from './modules/telegram/telegram.routes';
import { cronRoutes } from './modules/scheduler/cron.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting(env.TRUST_PROXY));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false }, customProps: (req) => ({ clientIp: (req as express.Request).ip }) }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // personal data: never cache at a CDN or proxy
    next();
  });
  api.use(healthRoutes);
  api.use('/telegram', telegramWebhookRoutes); // secret-header auth; must precede CSRF guard
  api.use('/internal', cronRoutes); // shared-secret auth; must precede CSRF guard
  api.use(csrfGuard);
  api.use(limits.api);
  api.use('/auth', authRoutes);
  api.use('/telegram', telegramRoutes);

  const authed = express.Router();
  authed.use(requireAuth);
  authed.use('/settings', settingsRoutes);
  authed.use('/timesheets', timesheetRoutes);
  authed.use('/timer', timerRoutes);
  authed.use('/journal', journalRoutes);
  authed.use('/calendar', calendarRoutes);
  authed.use('/suggestions', suggestionRoutes);
  authed.use('/sync', syncRoutes);
  authed.use('/integrations', integrationRoutes);
  authed.use('/reports', reportRoutes);
  authed.use('/exports', exportRoutes);
  authed.use('/notifications', notificationRoutes);
  authed.use('/assistant', assistantRoutes);
  authed.use(workRoutes);
  authed.use(dashboardRoutes);
  api.use(authed);
  api.use(apiNotFound);

  app.use('/api/v1', api);

  // Serve the built web app (single-container deployment).
  const webDir = env.WEB_DIST_DIR ?? path.resolve(process.cwd(), 'apps/web/dist');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use(errorMiddleware);
  return app;
}
