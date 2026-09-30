import { z } from 'zod';
import { NOTIFICATION_TYPES } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { HM_REGEX, isValidTimeZone, localDate } from '../../lib/time';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import type { AiProvider, UserSettings } from '../../generated/prisma/client';

export interface UserContext {
  userId: string;
  email: string;
  name: string;
  tz: string;
  settings: UserSettings;
}

export function defaultAiProvider(): AiProvider {
  return env.AI_PROVIDER.toUpperCase() as AiProvider;
}

export async function getSettings(userId: string): Promise<UserSettings> {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId, aiProvider: defaultAiProvider(), aiEnabled: env.AI_PROVIDER !== 'none' },
    update: {},
  });
}

export async function getUserContext(userId: string): Promise<UserContext> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw notFound('User');
  return { userId, email: user.email, name: user.name, tz: user.timezone, settings: await getSettings(userId) };
}

export const today = (ctx: Pick<UserContext, 'tz'>, now = new Date()) => localDate(now, ctx.tz);

export function isWorkingDay(settings: Pick<UserSettings, 'workingDays'>, isoWeekday: number): boolean {
  return settings.workingDays.includes(isoWeekday);
}

const hm = z.string().regex(HM_REGEX, 'Expected HH:mm');
const channel = z.enum(['TELEGRAM', 'EMAIL', 'BROWSER_PUSH', 'IN_APP']);

export const settingsPatchSchema = z
  .strictObject({
    version: z.number().int().optional(),
    timezone: z.string().refine(isValidTimeZone, 'Unknown timezone').optional(),
    workStartTime: hm.optional(),
    workEndTime: hm.optional(),
    expectedDailyMinutes: z.number().int().min(0).max(1440).optional(),
    workingDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    lunchStart: hm.nullable().optional(),
    lunchEnd: hm.nullable().optional(),
    allowTimesheetReopen: z.boolean().optional(),
    dailyReminderEnabled: z.boolean().optional(),
    dailyReminderTime: hm.optional(),
    confirmationReminderEnabled: z.boolean().optional(),
    confirmationReminderTime: hm.optional(),
    tomorrowSummaryEnabled: z.boolean().optional(),
    tomorrowSummaryTime: hm.optional(),
    meetingReminderEnabled: z.boolean().optional(),
    meetingReminderMinutes: z.number().int().min(1).max(240).optional(),
    morningSummaryEnabled: z.boolean().optional(),
    morningSummaryTime: hm.optional(),
    notificationChannel: channel.optional(),
    notificationFallbackChannel: channel.nullable().optional(),
    githubSyncEnabled: z.boolean().optional(),
    zohoSyncEnabled: z.boolean().optional(),
    jiraSyncEnabled: z.boolean().optional(),
    aiEnabled: z.boolean().optional(),
    aiProvider: z.enum(['NONE', 'GEMINI', 'OPENROUTER', 'OLLAMA']).optional(),
    aiDataMode: z.enum(['LOCAL_ONLY', 'MINIMAL_REMOTE', 'FULL_CONTEXT']).optional(),
    aiConfirmationPolicy: z.enum(['ALWAYS_CONFIRM_WRITES', 'CONFIRM_DANGEROUS_ONLY']).optional(),
    aiDailyRequestLimit: z.number().int().min(0).max(10000).optional(),
    assistantName: z.string().min(1).max(40).optional(),
  })
  .refine((v) => !(v.workStartTime && v.workEndTime) || v.workStartTime < v.workEndTime, {
    message: 'workEndTime must be after workStartTime',
  });

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function updateSettings(userId: string, patch: SettingsPatch, actor: 'USER' | 'AI' = 'USER') {
  const current = await getSettings(userId);
  if (patch.version !== undefined && patch.version !== current.version) {
    throw conflict('STALE_SETTINGS', 'Settings were changed elsewhere. Reload and try again.');
  }
  const { version: _v, timezone, ...data } = patch;
  if (data.aiDataMode === 'LOCAL_ONLY' && (data.aiProvider ?? current.aiProvider) !== 'OLLAMA' && (data.aiEnabled ?? current.aiEnabled)) {
    throw badRequest('AI_MODE_CONFLICT', 'LOCAL_ONLY data mode requires the Ollama (local) provider.');
  }
  if (timezone) await prisma.user.update({ where: { id: userId }, data: { timezone } });
  const updated = await prisma.userSettings.update({ where: { userId }, data: { ...data, version: { increment: 1 } } });
  await audit(userId, actor, 'settings.changed', 'UserSettings', updated.id, { fields: Object.keys(patch).filter((k) => k !== 'version') });
  return updated;
}

export async function listNotificationPreferences(userId: string) {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId } });
  return NOTIFICATION_TYPES.map((type) => {
    const p = prefs.find((x) => x.type === type);
    return { type, enabled: p?.enabled ?? true, channel: p?.channel ?? null };
  });
}

export async function setNotificationPreference(
  userId: string,
  type: (typeof NOTIFICATION_TYPES)[number],
  patch: { enabled?: boolean; channel?: 'TELEGRAM' | 'EMAIL' | 'BROWSER_PUSH' | 'IN_APP' | null },
  actor: 'USER' | 'AI' = 'USER',
) {
  const pref = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, enabled: patch.enabled ?? true, channel: patch.channel ?? null },
    update: { ...(patch.enabled !== undefined && { enabled: patch.enabled }), ...(patch.channel !== undefined && { channel: patch.channel }) },
  });
  await audit(userId, actor, 'notification_preference.changed', 'NotificationPreference', pref.id, { type, ...patch });
  return pref;
}
