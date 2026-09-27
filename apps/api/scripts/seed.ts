/**
 * Optional demo data for local development: projects, a sprint, tickets, meetings and
 * GitHub activity as if they had been synced. Never run against production data.
 * Usage: npm run db:seed   (requires ADMIN_EMAIL of an existing user)
 */
import { prisma } from '../src/lib/prisma';
import { addDays, localDate, zonedTimeToUtc } from '../src/lib/time';

const email = process.env.ADMIN_EMAIL?.toLowerCase();
const user = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findFirst();
if (!user) throw new Error('No user found. Start the app once with ADMIN_EMAIL/ADMIN_PASSWORD first.');
const tz = user.timezone;
const today = localDate(new Date(), tz);
const at = (d: string, t: string) => zonedTimeToUtc(d, t, tz);
const userId = user.id;

const project = await prisma.project.upsert({
  where: { userId_provider_externalId: { userId, provider: 'ZOHO', externalId: 'demo-project' } },
  create: { userId, provider: 'ZOHO', externalId: 'demo-project', name: 'Enrollment (demo)', key: 'ER', syncedAt: new Date() },
  update: {},
});
const sprint = await prisma.sprint.upsert({
  where: { userId_provider_externalId: { userId, provider: 'ZOHO', externalId: 'demo-sprint' } },
  create: { userId, provider: 'ZOHO', externalId: 'demo-sprint', projectId: project.id, name: 'Sprint 24 (demo)', status: 'ACTIVE', goal: 'Payments v2', startDate: new Date(`${addDays(today, -6)}T00:00:00Z`), endDate: new Date(`${addDays(today, 7)}T00:00:00Z`), syncedAt: new Date() },
  update: {},
});
const tickets = [
  ['ER-431', 'Payment retry logic', 'In Progress'],
  ['ER-438', 'Refund API validation', 'Open'],
  ['ER-440', 'Checkout error states', 'Closed'],
] as const;
for (const [key, title, status] of tickets) {
  await prisma.workItem.upsert({
    where: { userId_provider_externalId: { userId, provider: 'ZOHO', externalId: `demo-${key}` } },
    create: { userId, provider: 'ZOHO', externalId: `demo-${key}`, ticketKey: key, title, status, projectId: project.id, sprintId: sprint.id, isAssignedToMe: true, syncedAt: new Date() },
    update: {},
  });
}
for (const [i, [title, start, end]] of ([['Daily standup', '10:00', '10:15'], ['Sprint planning', '14:00', '15:00']] as const).entries()) {
  await prisma.calendarEvent.upsert({
    where: { userId_provider_externalId: { userId, provider: 'ZOHO', externalId: `demo-event-${i}-${today}` } },
    create: { userId, provider: 'ZOHO', externalId: `demo-event-${i}-${today}`, calendarExternalId: 'demo', title, startAt: at(today, start), endAt: at(today, end), meetingUrl: 'https://meet.google.com/demo-demo-demo', syncedAt: new Date() },
    update: {},
  });
}
const repo = await prisma.githubRepository.upsert({
  where: { userId_externalId: { userId, externalId: 'demo-repo' } },
  create: { userId, externalId: 'demo-repo', fullName: 'acme/enrollment', url: 'https://github.com/acme/enrollment', isSelected: true, syncedAt: new Date() },
  update: {},
});
for (const [i, t] of ['11:05', '12:40'].entries()) {
  await prisma.githubActivity.upsert({
    where: { userId_externalId: { userId, externalId: `demo-commit-${i}-${today}` } },
    create: { userId, repositoryId: repo.id, externalId: `demo-commit-${i}-${today}`, type: 'COMMIT', title: `ER-431 retry backoff step ${i + 1}`, occurredAt: at(today, t), ticketKeys: ['ER-431'], syncedAt: new Date() },
    update: {},
  });
}
console.log('Demo data seeded for', user.email);
await prisma.$disconnect();
