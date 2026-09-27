import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { createUser } from '../src/modules/auth/auth.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import type { NotificationProvider } from '../src/modules/notifications/providers/types';
import { runUserJobs } from '../src/modules/scheduler/jobs';
import { zonedTimeToUtc } from '../src/lib/time';

vi.mock('nodemailer', () => {
  const sendMail = vi.fn().mockResolvedValue({});
  return { default: { createTransport: () => ({ sendMail }) }, __sendMail: sendMail };
});

const TZ = 'Asia/Kolkata';
const DAY = '2026-09-22'; // a Tuesday
const at = (t: string) => zonedTimeToUtc(DAY, t, TZ);

function fakeProvider(channel: 'TELEGRAM' | 'EMAIL', available = true, fail = false) {
  const sent: string[] = [];
  const p: NotificationProvider = {
    channel,
    isAvailable: async () => available,
    send: async (_u, m) => {
      if (fail) throw new Error('boom');
      sent.push(m.type);
    },
  };
  return { p, sent };
}

async function newUser() {
  return createUser({ email: `n-${randomUUID()}@test.local`, password: 'correct-horse-battery', name: 'N', timezone: TZ });
}

describe('scheduler + notifications (injectable clock)', () => {
  let tg: ReturnType<typeof fakeProvider>;
  let svc: NotificationService;
  beforeEach(() => {
    tg = fakeProvider('TELEGRAM');
    svc = new NotificationService([tg.p]);
  });

  it('sends the 17:00 timesheet reminder once, even across repeated ticks', async () => {
    const u = await newUser();
    await runUserJobs(u.id, { notify: svc, now: at('16:59') });
    expect(tg.sent).not.toContain('TIMESHEET_REMINDER');
    await runUserJobs(u.id, { notify: svc, now: at('17:00') });
    await runUserJobs(u.id, { notify: svc, now: at('17:05') });
    await Promise.all([runUserJobs(u.id, { notify: svc, now: at('17:10') }), runUserJobs(u.id, { notify: svc, now: at('17:10') })]);
    expect(tg.sent.filter((t) => t === 'TIMESHEET_REMINDER')).toHaveLength(1);
    await runUserJobs(u.id, { notify: svc, now: at('17:30') });
    expect(tg.sent).toContain('TIMESHEET_CONFIRMATION');
  });

  it('respects configurable reminder times from settings', async () => {
    const u = await newUser();
    await prisma.userSettings.update({ where: { userId: u.id }, data: { dailyReminderTime: '18:15' } });
    await runUserJobs(u.id, { notify: svc, now: at('17:00') });
    expect(tg.sent).not.toContain('TIMESHEET_REMINDER');
    await runUserJobs(u.id, { notify: svc, now: at('18:20') });
    expect(tg.sent).toContain('TIMESHEET_REMINDER');
  });

  it('skips timesheet reminders on holidays and after submission', async () => {
    const u = await newUser();
    await prisma.holiday.create({ data: { userId: u.id, date: new Date(`${DAY}T00:00:00Z`), name: 'Festival' } });
    await runUserJobs(u.id, { notify: svc, now: at('17:00') });
    expect(tg.sent).not.toContain('TIMESHEET_REMINDER');
  });

  it('sends meeting reminders once, and not for cancelled or opted-out meetings', async () => {
    const u = await newUser();
    const mk = (id: string, extra = {}) => prisma.calendarEvent.create({ data: { userId: u.id, provider: 'ZOHO', externalId: id, calendarExternalId: 'c', title: id, startAt: at('11:00'), endAt: at('11:30'), syncedAt: new Date(), ...extra } });
    await mk('ok');
    await mk('cancelled', { status: 'CANCELLED' });
    const opted = await mk('opted');
    await prisma.calendarEventLocal.create({ data: { calendarEventId: opted.id, reminderEnabled: false } });
    await runUserJobs(u.id, { notify: svc, now: at('10:30') });
    expect(tg.sent.filter((t) => t === 'MEETING_REMINDER')).toHaveLength(0);
    await runUserJobs(u.id, { notify: svc, now: at('10:46') });
    await runUserJobs(u.id, { notify: svc, now: at('10:50') });
    expect(tg.sent.filter((t) => t === 'MEETING_REMINDER')).toHaveLength(1);
  });

  it('sends tomorrow schedule at 23:00', async () => {
    const u = await newUser();
    await runUserJobs(u.id, { notify: svc, now: at('23:00') });
    expect(tg.sent).toContain('TOMORROW_SCHEDULE');
  });

  it('falls back to another channel and records every delivery attempt', async () => {
    const u = await newUser();
    const broken = fakeProvider('TELEGRAM', true, true);
    const email = fakeProvider('EMAIL');
    const s = new NotificationService([broken.p, email.p]);
    const res = await s.notify({ userId: u.id, type: 'WEEKLY_SUMMARY', sourceEntityId: 'w1', scheduledDate: DAY, message: { title: 't', body: 'b' } });
    expect(res).toMatchObject({ status: 'SENT', channel: 'EMAIL' });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: u.id }, include: { deliveries: true } });
    expect(n.deliveries.map((d) => `${d.channel}:${d.status}`).sort()).toEqual(['EMAIL:SENT', 'TELEGRAM:FAILED']);
    const again = await s.notify({ userId: u.id, type: 'WEEKLY_SUMMARY', sourceEntityId: 'w1', scheduledDate: DAY, message: { title: 't', body: 'b' } });
    expect(again.status).toBe('SKIPPED');
  });

  it('honours disabled notification types', async () => {
    const u = await newUser();
    await prisma.notificationPreference.create({ data: { userId: u.id, type: 'TIMESHEET_REMINDER', enabled: false } });
    await runUserJobs(u.id, { notify: svc, now: at('17:00') });
    expect(tg.sent).not.toContain('TIMESHEET_REMINDER');
  });

  it('sends email through the SMTP provider', async () => {
    const { EmailNotificationProvider } = await import('../src/modules/notifications/providers/email.provider');
    const nodemailer = (await import('nodemailer')) as unknown as { __sendMail: ReturnType<typeof vi.fn> };
    const u = await newUser();
    await new EmailNotificationProvider().send(u.id, { title: 'Hello <b>', body: 'Body', url: 'https://example.com' });
    expect(nodemailer.__sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: u.email, subject: expect.stringContaining('Hello <b>') }));
    expect(nodemailer.__sendMail.mock.lastCall?.[0].html).toContain('Hello &lt;b&gt;');
  });
});
