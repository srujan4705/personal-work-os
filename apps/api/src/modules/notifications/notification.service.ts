import type { NotificationType } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { isUniqueViolation } from '../../lib/errors';
import { getSettings } from '../settings/settings.service';
import type { NotificationChannel } from '../../generated/prisma/enums';
import type { NotificationProvider } from './providers/types';
import type { NotificationMessage } from './templates';
import { TelegramNotificationProvider } from './providers/telegram.provider';
import { EmailNotificationProvider } from './providers/email.provider';
import { WebPushNotificationProvider } from './providers/webpush.provider';
import { InAppNotificationProvider } from './providers/inapp.provider';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  sourceEntityId: string;
  scheduledDate: string;
  message: Omit<NotificationMessage, 'type'>;
  force?: boolean;
}

export type NotifyResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; channel?: NotificationChannel; reason?: string };

/**
 * Sends a notification at most once per (user, type, source entity, scheduled date).
 * The unique idempotency key is claimed in the database BEFORE delivery, so concurrent
 * scheduler ticks or restarts can never double-send.
 */
export class NotificationService {
  private readonly providers: Map<NotificationChannel, NotificationProvider>;

  constructor(providers: NotificationProvider[]) {
    this.providers = new Map(providers.map((p) => [p.channel, p]));
  }

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const [settings, pref] = await Promise.all([
      getSettings(input.userId),
      prisma.notificationPreference.findUnique({ where: { userId_type: { userId: input.userId, type: input.type } } }),
    ]);
    if (!input.force && pref && !pref.enabled) return { status: 'SKIPPED', reason: 'disabled' };

    const idempotencyKey = `${input.userId}:${input.type}:${input.sourceEntityId}:${input.scheduledDate}`;
    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          userId: input.userId, type: input.type, scheduledFor: new Date(), idempotencyKey,
          title: input.message.title, body: input.message.body,
          payload: { url: input.message.url ?? null, sourceEntityId: input.sourceEntityId, scheduledDate: input.scheduledDate },
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        logger.debug({ idempotencyKey }, 'notification.skipped_duplicate');
        return { status: 'SKIPPED', reason: 'duplicate' };
      }
      throw err;
    }

    const order = [pref?.channel ?? settings.notificationChannel, settings.notificationFallbackChannel, 'IN_APP' as const]
      .filter((c, i, arr): c is NotificationChannel => !!c && arr.indexOf(c) === i);
    for (const channel of order) {
      const provider = this.providers.get(channel);
      if (!provider || !(await provider.isAvailable(input.userId))) continue;
      try {
        await provider.send(input.userId, { ...input.message, type: input.type });
        await prisma.$transaction([
          prisma.notificationDelivery.create({ data: { notificationId: notification.id, channel, status: 'SENT' } }),
          prisma.notification.update({ where: { id: notification.id }, data: { status: 'SENT', sentAt: new Date() } }),
        ]);
        logger.info({ type: input.type, channel }, 'notification.sent');
        return { status: 'SENT', channel };
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 300) : 'failed';
        await prisma.notificationDelivery.create({ data: { notificationId: notification.id, channel, status: 'FAILED', error: message } });
        logger.warn({ type: input.type, channel, err: message }, 'notification.failed');
      }
    }
    await prisma.notification.update({ where: { id: notification.id }, data: { status: 'FAILED' } });
    return { status: 'FAILED', reason: 'no channel delivered' };
  }

  /** Test message on one channel. Not idempotent by design. */
  async sendTest(userId: string, channel: NotificationChannel) {
    const provider = this.providers.get(channel);
    if (!provider || !(await provider.isAvailable(userId))) return { sent: false, reason: `${channel} is not configured or linked.` };
    await provider.send(userId, { type: 'MORNING_SUMMARY', title: 'Test notification', body: 'Personal Work OS notifications are working.' });
    return { sent: true };
  }

  async availableChannels(userId: string) {
    const out: Record<string, boolean> = {};
    for (const [channel, p] of this.providers) out[channel] = await p.isAvailable(userId);
    return out;
  }
}

export function createDefaultNotificationService() {
  return new NotificationService([
    new TelegramNotificationProvider(),
    new EmailNotificationProvider(),
    new WebPushNotificationProvider(),
    new InAppNotificationProvider(),
  ]);
}

let instance: NotificationService | undefined;
export const notifications = () => (instance ??= createDefaultNotificationService());
export const setNotificationService = (s: NotificationService) => {
  instance = s;
};
