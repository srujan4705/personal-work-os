import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { audit } from '../audit/audit.service';
import { defaultAiProvider } from '../settings/settings.service';
import type { AuthUser } from '../../lib/http';

export const SESSION_COOKIE = 'pwos_session';

// A fixed hash so unknown emails take as long as wrong passwords.
let dummyHash: Promise<string> | undefined;

export async function login(email: string, password: string, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  dummyHash ??= hashPassword('dummy-password-for-timing');
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !user.isActive || !valid) {
    logger.info({ email }, 'auth.login_failed');
    throw unauthorized('Invalid email or password.');
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);
  await prisma.session.create({ data: { userId: user.id, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 200), expiresAt } });
  await audit(user.id, 'USER', 'auth.login', 'User', user.id);
  return { token, expiresAt, user: toAuthUser(user) };
}

export async function logout(token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function userFromSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  return toAuthUser(session.user);
}

const toAuthUser = (u: { id: string; email: string; name: string; timezone: string }): AuthUser => ({
  id: u.id, email: u.email, name: u.name, timezone: u.timezone,
});

export async function createUser(input: { email: string; password: string; name: string; timezone: string }) {
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      timezone: input.timezone,
      passwordHash: await hashPassword(input.password),
      settings: { create: { aiProvider: defaultAiProvider(), aiEnabled: env.AI_PROVIDER !== 'none' } },
    },
  });
}

/** Creates the single V1 user from ADMIN_* env vars when the database has no users. */
export async function bootstrapAdmin() {
  if ((await prisma.user.count()) > 0) return;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    logger.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) and restart.');
    return;
  }
  const user = await createUser({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME, timezone: env.ADMIN_TIMEZONE });
  await audit(user.id, 'SYSTEM', 'user.bootstrapped', 'User', user.id);
  logger.info({ email: user.email }, 'auth.admin_created');
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw unauthorized('Current password is incorrect.');
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await audit(userId, 'USER', 'auth.password_changed', 'User', userId);
}
