import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { createUser } from '../src/modules/auth/auth.service';
import { prisma } from '../src/lib/prisma';

export const app = createApp();
export const PASSWORD = 'correct-horse-battery';

/** Creates a user and returns a supertest agent logged in as them. */
export async function loginAs(timezone = 'Asia/Kolkata') {
  const email = `u-${randomUUID()}@test.local`;
  const user = await createUser({ email, password: PASSWORD, name: 'Tester', timezone });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').set('x-pwos-csrf', '1').send({ email, password: PASSWORD }).expect(200);
  const csrf = (r: request.Test) => r.set('x-pwos-csrf', '1');
  return {
    user,
    agent,
    get: (url: string) => agent.get(`/api/v1${url}`),
    post: (url: string, body: object = {}) => csrf(agent.post(`/api/v1${url}`)).send(body),
    patch: (url: string, body: object = {}) => csrf(agent.patch(`/api/v1${url}`)).send(body),
    del: (url: string) => csrf(agent.delete(`/api/v1${url}`)),
  };
}

export async function seedTicket(userId: string, ticketKey: string, extra: Record<string, unknown> = {}) {
  return prisma.workItem.create({
    data: { userId, provider: 'ZOHO', externalId: `ext-${randomUUID()}`, ticketKey, title: `Title ${ticketKey}`, isAssignedToMe: true, syncedAt: new Date(), ...extra },
  });
}
