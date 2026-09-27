import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from './helpers';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { createUser } from '../src/modules/auth/auth.service';

const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const tick = (scope?: string, auth: string | null = `Bearer ${SECRET}`) => {
  const r = request(app).post(`/api/v1/internal/cron/tick${scope ? `?scope=${scope}` : ''}`);
  return auth ? r.set('Authorization', auth) : r;
};

describe('external cron trigger', () => {
  afterEach(() => { env.CRON_SECRET = SECRET; });

  it('is disabled (404) when CRON_SECRET is not set', async () => {
    env.CRON_SECRET = undefined;
    await tick().expect(404);
  });

  it('rejects missing or wrong credentials without needing a session or CSRF header', async () => {
    await tick(undefined, null).expect(401);
    await tick(undefined, 'Bearer wrong').expect(401);
    await tick(undefined, SECRET).expect(401); // no "Bearer " prefix
  });

  it('validates scope', async () => {
    await tick('everything').expect(400);
  });

  it('runs notification jobs idempotently for active users', async () => {
    const u = await createUser({ email: `c-${randomUUID()}@test.local`, password: 'correct-horse-battery', name: 'C', timezone: 'UTC' });
    const now = new Date();
    const start = new Date(now.getTime() + 5 * 60_000);
    await prisma.calendarEvent.create({ data: { userId: u.id, provider: 'ZOHO', externalId: `cron-${randomUUID()}`, calendarExternalId: 'c', title: 'Soon', startAt: start, endAt: new Date(start.getTime() + 30 * 60_000), syncedAt: now } });

    const first = await tick('notifications').expect(200);
    expect(first.body.data).toMatchObject({ scope: 'notifications', status: 'completed' });
    expect(first.body.data.users).toBeGreaterThan(0);
    await tick('notifications').expect(200);

    const reminders = await prisma.notification.count({ where: { userId: u.id, type: 'MEETING_REMINDER' } });
    expect(reminders).toBe(1);
  });

  it('sync scope does not send notifications', async () => {
    const u = await createUser({ email: `s-${randomUUID()}@test.local`, password: 'correct-horse-battery', name: 'S', timezone: 'UTC' });
    const start = new Date(Date.now() + 5 * 60_000);
    await prisma.calendarEvent.create({ data: { userId: u.id, provider: 'ZOHO', externalId: `sync-${randomUUID()}`, calendarExternalId: 'c', title: 'Soon', startAt: start, endAt: new Date(start.getTime() + 30 * 60_000), syncedAt: new Date() } });
    const r = await tick('sync').expect(200);
    expect(r.body.data.scope).toBe('sync');
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0);
  });

  it('marks API responses as not cacheable', async () => {
    const r = await request(app).get('/api/v1/health').expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
