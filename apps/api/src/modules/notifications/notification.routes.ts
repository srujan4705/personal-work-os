import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATION_TYPES } from '@pwos/shared';
import { ok, parse, userOf } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { limits } from '../../middleware/security';
import { notifications } from './notification.service';
import { webPushConfigured } from './providers/webpush.provider';
import { listNotificationPreferences, setNotificationPreference } from '../settings/settings.service';

export const notificationRoutes = Router();
const channel = z.enum(['TELEGRAM', 'EMAIL', 'BROWSER_PUSH', 'IN_APP']);

notificationRoutes.get('/history', async (req, res) => {
  const rows = await prisma.notification.findMany({ where: { userId: userOf(req).id }, orderBy: { createdAt: 'desc' }, take: 100, include: { deliveries: true } });
  ok(res, rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, status: n.status, createdAt: n.createdAt, sentAt: n.sentAt, deliveries: n.deliveries.map((d) => ({ channel: d.channel, status: d.status, error: d.error, attemptedAt: d.attemptedAt })) })));
});

notificationRoutes.get('/channels', async (req, res) => ok(res, await notifications().availableChannels(userOf(req).id)));
notificationRoutes.get('/preferences', async (req, res) => ok(res, await listNotificationPreferences(userOf(req).id)));
notificationRoutes.patch('/preferences/:type', async (req, res) => {
  const type = parse(z.enum(NOTIFICATION_TYPES), req.params.type);
  ok(res, await setNotificationPreference(userOf(req).id, type, parse(z.object({ enabled: z.boolean().optional(), channel: channel.nullable().optional() }), req.body)));
});

notificationRoutes.post('/test', limits.notify, async (req, res) => ok(res, await notifications().sendTest(userOf(req).id, parse(z.object({ channel }), req.body).channel)));

notificationRoutes.get('/push/public-key', (_req, res) => ok(res, { configured: webPushConfigured(), publicKey: env.VAPID_PUBLIC_KEY ?? null }));
notificationRoutes.post('/push/subscribe', async (req, res) => {
  const body = parse(z.object({ endpoint: z.url().startsWith('https://'), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
  const user = userOf(req);
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: { userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
    update: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
  });
  ok(res, { subscribed: true }, 201);
});
notificationRoutes.post('/push/unsubscribe', async (req, res) => {
  const body = parse(z.object({ endpoint: z.url() }), req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: userOf(req).id } });
  ok(res, { unsubscribed: true });
});
