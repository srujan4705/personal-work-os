import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { NotificationService } from '../notifications/notification.service';
import { runUserJobs, type JobScope } from './jobs';

const inFlight = new Set<JobScope>();

/**
 * Runs the jobs of one scope for every active user. Shared by the in-process timer and
 * the external cron endpoint. Returns null if a run of the same scope is still in progress
 * (single instance; notifications are also idempotent in the database).
 */
export async function runScheduledJobs(notify: NotificationService, now: Date, scope: JobScope = 'all'): Promise<{ users: number } | null> {
  if (inFlight.has(scope) || inFlight.has('all') || (scope === 'all' && inFlight.size > 0)) return null;
  inFlight.add(scope);
  try {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
    for (const u of users) {
      await runUserJobs(u.id, { notify, now, scope }).catch((err) => logger.error({ err, userId: u.id, scope }, 'scheduler.user_jobs_failed'));
    }
    return { users: users.length };
  } finally {
    inFlight.delete(scope);
  }
}

/**
 * Database-aware in-process scheduler. No external queue: every job derives what to do
 * from the database and the injected clock, and notifications are idempotent, so
 * restarts and overlapping ticks are safe. Disable with SCHEDULER_ENABLED=false when an
 * external trigger (POST /api/v1/internal/cron/tick) drives the jobs instead.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly notify: NotificationService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async tick(): Promise<void> {
    await runScheduledJobs(this.notify, this.clock(), 'all');
  }

  start(intervalSeconds: number) {
    this.timer = setInterval(() => void this.tick(), intervalSeconds * 1000);
    void this.tick();
    logger.info({ intervalSeconds }, 'scheduler.started');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
