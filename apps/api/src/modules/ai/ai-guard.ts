import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { dateToDb } from '../../lib/time';

const recent = new Map<string, number[]>();

/**
 * Cost guard: per-minute burst limit (in memory) + per-day request limit (database, atomic).
 * Returns false when the request must not be sent to the AI provider.
 */
export async function reserveAiRequest(userId: string, localToday: string, dailyLimit: number, now = Date.now()): Promise<{ allowed: boolean; reason?: string }> {
  const window = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (window.length >= env.AI_REQUESTS_PER_MINUTE) return { allowed: false, reason: 'AI rate limit reached. Try again in a minute.' };
  if (dailyLimit <= 0) return { allowed: false, reason: 'AI daily limit is 0.' };

  const key = { userId_date: { userId, date: dateToDb(localToday) } };
  await prisma.aiUsageDaily.upsert({ where: key, create: { userId, date: dateToDb(localToday) }, update: {} });
  const res = await prisma.aiUsageDaily.updateMany({ where: { userId, date: dateToDb(localToday), requests: { lt: dailyLimit } }, data: { requests: { increment: 1 } } });
  if (res.count !== 1) return { allowed: false, reason: `Daily AI limit (${dailyLimit} requests) reached.` };
  window.push(now);
  recent.set(userId, window);
  return { allowed: true };
}

export async function recordAiTokens(userId: string, localToday: string, usage: { inputTokens: number; outputTokens: number }) {
  await prisma.aiUsageDaily.updateMany({
    where: { userId, date: dateToDb(localToday) },
    data: { inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens } },
  });
}

export async function aiUsageToday(userId: string, localToday: string) {
  const row = await prisma.aiUsageDaily.findUnique({ where: { userId_date: { userId, date: dateToDb(localToday) } } });
  return { requests: row?.requests ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0 };
}

const SENSITIVE_KEY = /(email|attendee|organizer|token|secret|password|apikey|api_key|authorization)/i;

/**
 * Data minimisation before anything leaves the server.
 * MINIMAL_REMOTE: drops personal fields and long free text; FULL_CONTEXT: drops only secrets.
 */
export function minimizeForAi(data: unknown, mode: 'LOCAL_ONLY' | 'MINIMAL_REMOTE' | 'FULL_CONTEXT', depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(data)) return data.slice(0, 50).map((d) => minimizeForAi(d, mode, depth + 1));
  if (data instanceof Date) return data.toISOString();
  if (typeof data === 'string') return mode === 'MINIMAL_REMOTE' ? data.slice(0, 300) : data.slice(0, 2000);
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (/(token|secret|password|apikey|api_key|authorization)/i.test(k)) continue;
    if (mode === 'MINIMAL_REMOTE' && (SENSITIVE_KEY.test(k) || k === 'description' || k === 'meetingUrl' || k === 'location')) continue;
    out[k] = minimizeForAi(v, mode, depth + 1);
  }
  return out;
}
