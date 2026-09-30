import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { limits } from '../../middleware/security';
import { prisma } from '../../lib/prisma';
import { randomToken } from '../../lib/crypto';
import { badRequest } from '../../lib/errors';
import { cookieSecure, env } from '../../config/env';
import { syncGithub, syncJira, syncStatus, syncZoho, zohoOptions } from './sync.service';
import { buildAuthorizeUrl, completeAuthorization, disconnectZoho } from '../integrations/oauth/zoho-oauth';
import { connectJira, disconnectJira } from '../integrations/oauth/jira-auth';
import { audit } from '../audit/audit.service';

export const syncRoutes = Router();
syncRoutes.post('/zoho', limits.sync, async (req, res) => ok(res, await syncZoho(userOf(req).id)));
syncRoutes.post('/github', limits.sync, async (req, res) => ok(res, await syncGithub(userOf(req).id)));
syncRoutes.post('/jira', limits.sync, async (req, res) => ok(res, await syncJira(userOf(req).id)));
syncRoutes.get('/status', async (req, res) => ok(res, await syncStatus(userOf(req).id)));

export const integrationRoutes = Router();
const STATE_COOKIE = 'pwos_zoho_state';

/** Starts the Zoho OAuth flow (READ scopes only). */
integrationRoutes.get('/zoho/connect', (req, res) => {
  userOf(req);
  const state = randomToken(16);
  res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: cookieSecure, sameSite: 'lax', maxAge: 10 * 60_000, path: '/' });
  res.redirect(buildAuthorizeUrl(state));
});

integrationRoutes.get('/zoho/callback', async (req, res) => {
  const user = userOf(req);
  const q = parse(z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), 'accounts-server': z.url().optional() }), req.query);
  const expected = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });
  if (q.error) return res.redirect(`${env.APP_URL}/settings?zoho=denied`);
  if (!q.code || !q.state || !expected || q.state !== expected) throw badRequest('INVALID_OAUTH_STATE', 'Invalid OAuth state. Please try connecting again.');
  await completeAuthorization(user.id, q.code, q['accounts-server']);
  res.redirect(`${env.APP_URL}/settings?zoho=connected`);
});

integrationRoutes.get('/zoho/options', async (req, res) => ok(res, await zohoOptions(userOf(req).id)));

integrationRoutes.patch('/zoho', async (req, res) => {
  const body = parse(z.object({ portalId: z.string().max(64).nullable().optional(), sprintsTeamId: z.string().max(64).nullable().optional() }), req.body);
  const user = userOf(req);
  const updated = await prisma.zohoIntegration.update({ where: { userId: user.id }, data: body });
  await audit(user.id, 'USER', 'integration.zoho.configured', 'ZohoIntegration', updated.id, body);
  ok(res, { portalId: updated.portalId, sprintsTeamId: updated.sprintsTeamId });
});

integrationRoutes.delete('/zoho', async (req, res) => {
  await disconnectZoho(userOf(req).id);
  ok(res, { disconnected: true });
});

/** Verifies the credentials against Jira, then stores them. Nothing is redirected — this is a plain form POST, not OAuth. */
integrationRoutes.post('/jira/connect', async (req, res) => {
  const body = parse(z.object({ baseUrl: z.url(), email: z.email(), apiToken: z.string().min(10).max(500) }), req.body);
  const user = userOf(req);
  const result = await connectJira(user.id, body.baseUrl, body.email, body.apiToken);
  ok(res, { connected: true, displayName: result.displayName });
});

integrationRoutes.delete('/jira', async (req, res) => {
  await disconnectJira(userOf(req).id);
  ok(res, { disconnected: true });
});

integrationRoutes.get('/github/repositories', async (req, res) => {
  ok(res, await prisma.githubRepository.findMany({ where: { userId: userOf(req).id }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, url: true, isSelected: true, syncedAt: true } }));
});

integrationRoutes.patch('/github/repositories/:id', async (req, res) => {
  const body = parse(z.object({ isSelected: z.boolean() }), req.body);
  const user = userOf(req);
  const r = await prisma.githubRepository.updateMany({ where: { id: req.params.id, userId: user.id }, data: body });
  if (r.count === 0) throw badRequest('NOT_FOUND', 'Repository not found.');
  ok(res, { updated: true });
});
