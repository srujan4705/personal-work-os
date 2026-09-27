import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { limits } from '../../middleware/security';
import { getUserContext, today } from '../settings/settings.service';
import { resolveAiProvider } from '../ai/ai.factory';
import { aiUsageToday } from '../ai/ai-guard';
import { TOOLS, isToolName } from '@pwos/ai-contracts';
import { cancelAction, chat, confirmAction } from './assistant.service';

export const assistantRoutes = Router();

assistantRoutes.get('/status', async (req, res) => {
  const ctx = await getUserContext(userOf(req).id);
  const r = resolveAiProvider(ctx.settings);
  ok(res, {
    available: !!r.provider,
    provider: r.provider?.name ?? null,
    reason: r.provider ? null : r.reason,
    isRemote: r.provider?.isRemote ?? false,
    dataMode: ctx.settings.aiDataMode,
    confirmationPolicy: ctx.settings.aiConfirmationPolicy,
    usageToday: await aiUsageToday(ctx.userId, today(ctx)),
    dailyLimit: ctx.settings.aiDailyRequestLimit,
    assistantName: ctx.settings.assistantName,
  });
});

assistantRoutes.post('/message', limits.assistant, async (req, res) => {
  const body = parse(z.object({ message: z.string().trim().min(1).max(4000), conversationId: z.string().max(64).optional() }), req.body);
  ok(res, await chat(userOf(req).id, { ...body, channel: 'WEB' }));
});

assistantRoutes.post('/confirm-action', async (req, res) => ok(res, await confirmAction(userOf(req).id, parse(z.object({ actionId: z.string().max(64) }), req.body).actionId)));
assistantRoutes.post('/cancel-action', async (req, res) => ok(res, await cancelAction(userOf(req).id, parse(z.object({ actionId: z.string().max(64) }), req.body).actionId)));

assistantRoutes.get('/conversations', async (req, res) => {
  ok(res, await prisma.assistantConversation.findMany({ where: { userId: userOf(req).id }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, channel: true, updatedAt: true } }));
});

assistantRoutes.get('/conversations/:id', async (req, res) => {
  const userId = userOf(req).id;
  const c = await prisma.assistantConversation.findFirst({
    where: { id: req.params.id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 }, actions: { where: { status: 'AWAITING_CONFIRMATION', expiresAt: { gt: new Date() } } } },
  });
  if (!c) throw notFound('Conversation');
  ok(res, {
    id: c.id, title: c.title,
    messages: c.messages.filter((m) => m.role !== 'TOOL').map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
    pendingActions: c.actions.map((a) => {
      const summarize = isToolName(a.toolName) ? (TOOLS[a.toolName].summarize as ((x: unknown) => string) | undefined) : undefined;
      return { actionId: a.id, toolName: a.toolName, summary: summarize ? summarize(a.arguments) : a.toolName, expiresAt: a.expiresAt };
    }),
  });
});

assistantRoutes.delete('/conversations/:id', async (req, res) => {
  const r = await prisma.assistantConversation.deleteMany({ where: { id: req.params.id, userId: userOf(req).id } });
  if (r.count === 0) throw notFound('Conversation');
  ok(res, { deleted: true });
});

assistantRoutes.delete('/conversations', async (req, res) => {
  const r = await prisma.assistantConversation.deleteMany({ where: { userId: userOf(req).id } });
  ok(res, { deleted: r.count });
});

assistantRoutes.get('/actions', async (req, res) => {
  ok(res, await prisma.assistantActionLog.findMany({ where: { userId: userOf(req).id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, toolName: true, permission: true, status: true, confirmationRequired: true, confirmed: true, error: true, createdAt: true } }));
});
