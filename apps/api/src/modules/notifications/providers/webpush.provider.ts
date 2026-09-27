import webpush from 'web-push';
import { prisma } from '../../../lib/prisma';
import { env } from '../../../config/env';
import { logger } from '../../../lib/logger';
import type { NotificationProvider } from './types';

export const webPushConfigured = () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

export class WebPushNotificationProvider implements NotificationProvider {
  readonly channel = 'BROWSER_PUSH' as const;

  constructor() {
    if (webPushConfigured()) webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }

  async isAvailable(userId: string) {
    return webPushConfigured() && (await prisma.pushSubscription.count({ where: { userId } })) > 0;
  }

  async send(userId: string, message: { title: string; body: string; url?: string | null }) {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    let delivered = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: message.title, body: message.body, url: message.url ?? '/' }), { TTL: 3600 });
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        else logger.warn({ status }, 'push.send_failed');
      }
    }
    if (delivered === 0) throw new Error('No browser push subscription accepted the message.');
  }
}
