import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createApp } from './app';
import { bootstrapAdmin } from './modules/auth/auth.service';
import { notifications } from './modules/notifications/notification.service';
import { setSyncFailureNotifier } from './modules/sync/sync.service';
import { templates } from './modules/notifications/templates';
import { Scheduler } from './modules/scheduler/scheduler';
import { startTelegramPolling } from './modules/telegram/telegram.service';
import { getUserContext, today } from './modules/settings/settings.service';

async function main() {
  await prisma.$connect();
  await bootstrapAdmin();

  setSyncFailureNotifier(async (userId, resource, message) => {
    const ctx = await getUserContext(userId);
    await notifications().notify({ userId, type: 'SYNC_FAILURE', sourceEntityId: resource, scheduledDate: today(ctx), message: templates.syncFailure({ resource, message }) });
  });

  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, 'server.started'));

  const scheduler = new Scheduler(notifications());
  if (env.SCHEDULER_ENABLED) scheduler.start(env.SCHEDULER_TICK_SECONDS);
  const stopPolling = env.TELEGRAM_MODE === 'polling' && env.TELEGRAM_BOT_TOKEN ? startTelegramPolling() : () => {};

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'server.stopping');
    scheduler.stop();
    stopPolling();
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'server.failed_to_start');
  process.exit(1);
});
