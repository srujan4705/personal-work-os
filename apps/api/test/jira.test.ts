import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { loginAs } from './helpers';

const BASE = 'https://acme.atlassian.net';
const GATEWAY = 'https://api.atlassian.com/ex/jira/cloud-abc-123';
const ME = 'acc-me';

const issue = (id: string, key: string, projectId: string, projectKey: string, extra: Record<string, unknown> = {}) => ({
  id,
  key,
  fields: {
    summary: `Summary of ${key}`,
    status: { name: 'In Progress' },
    priority: { name: 'Medium' },
    assignee: { accountId: ME, displayName: 'Me' },
    project: { id: projectId, key: projectKey, name: `${projectKey} project` },
    duedate: null,
    resolutiondate: null,
    ...extra,
  },
});

/** A fake Jira Cloud that answers the documented endpoints, including the awkward real-world cases. */
function fakeJira(calls: { method: string; host: string; path: string; query: URLSearchParams }[]) {
  return vi.fn(async (input: URL | string, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push({ method: init?.method ?? 'GET', host: u.hostname, path: u.pathname, query: u.searchParams });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const auth = new Headers(init?.headers).get('Authorization') ?? '';

    // The site domain itself answers ONLY the cloud-ID lookup, unauthenticated — exactly like
    // real Jira Cloud. A scoped token calling the site directly for anything else (the bug
    // this test would have caught) gets Jira's real, unhelpful 401 with no JSON body.
    if (u.hostname === 'acme.atlassian.net') {
      if (u.pathname === '/_edge/tenant_info') return json({ cloudId: 'cloud-abc-123' });
      return new Response('Client must be authenticated to access this resource.', { status: 401 });
    }

    if (auth !== `Basic ${Buffer.from('me@acme.com:good-token-123').toString('base64')}`) return json({ message: 'Unauthorized' }, 401);
    if (!u.pathname.startsWith('/ex/jira/cloud-abc-123')) return json({ message: 'Unknown gateway path' }, 404);
    const path = u.pathname.slice('/ex/jira/cloud-abc-123'.length);

    switch (path) {
      case '/rest/api/3/myself':
        return json({ accountId: ME, displayName: 'Me' });
      case '/rest/api/3/search/jql':
        // Two pages linked by nextPageToken; the new endpoint returns no `total`.
        return u.searchParams.get('nextPageToken') === 'page-2'
          ? json({ issues: [issue('103', 'OPS-9', '20000', 'OPS')] })
          : json({ issues: [issue('101', 'ER-1', '10000', 'ER'), issue('102', 'ER-2', '10000', 'ER', { resolutiondate: '2026-09-20T10:00:00.000+0000' })], nextPageToken: 'page-2' });
      case '/rest/agile/1.0/board':
        return u.searchParams.get('projectKeyOrId') === '10000'
          ? json({ values: [{ id: 5, type: 'scrum' }, { id: 6, type: 'kanban' }] })
          : json({ values: [{ id: 7, type: 'scrum' }] });
      case '/rest/agile/1.0/board/5/sprint':
        return json({ values: [{ id: 77, name: 'Sprint 12', state: 'active', goal: 'Ship it', startDate: '2026-09-21T00:00:00.000Z', endDate: '2026-10-05T00:00:00.000Z' }] });
      case '/rest/agile/1.0/board/6/sprint':
        return json({ errorMessages: ['The board does not support sprints'] }, 400);
      case '/rest/agile/1.0/board/7/sprint':
        return json({ errorMessages: ['Sprints are disabled'] }, 400);
      case '/rest/agile/1.0/sprint/77/issue':
        return json({
          total: 3,
          issues: [
            issue('101', 'ER-1', '10000', 'ER'),
            issue('104', 'ER-3', '10000', 'ER', { assignee: { accountId: 'someone-else', displayName: 'Teammate' } }),
            issue('105', 'OPS-10', '20000', 'OPS'), // other project on a shared board
          ],
        });
      default:
        return json({ errorMessages: ['The requested API has been removed.'] }, 410);
    }
  });
}

describe('Jira integration', () => {
  const calls: { method: string; host: string; path: string; query: URLSearchParams }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', fakeJira(calls));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects bad credentials without storing anything', async () => {
    const s = await loginAs();
    const res = await s.post('/integrations/jira/connect', { baseUrl: BASE, email: 'me@acme.com', apiToken: 'wrong-token-000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('JIRA_AUTH_FAILED');
    expect(await prisma.jiraIntegration.findUnique({ where: { userId: s.user.id } })).toBeNull();
  });

  it('connects, syncs own tickets and the active sprint, read-only', async () => {
    const s = await loginAs();
    const connect = await s.post('/integrations/jira/connect', { baseUrl: `${BASE}/`, email: 'me@acme.com', apiToken: 'good-token-123' });
    expect(connect.status).toBe(200);
    expect(connect.body.data.displayName).toBe('Me');

    // The token is stored encrypted, never in plain text.
    const token = await prisma.oAuthToken.findUnique({ where: { userId_provider: { userId: s.user.id, provider: 'JIRA' } } });
    expect(token?.accessTokenEnc).not.toContain('good-token-123');

    // Settings accepts the new toggle (the schema is strict and rejects unknown keys).
    expect((await s.patch('/settings', { jiraSyncEnabled: false })).status).toBe(200);

    const sync = await s.post('/sync/jira');
    expect(sync.status).toBe(200);
    expect(sync.body.data).toEqual([expect.objectContaining({ resource: 'tickets_and_sprints', ok: true })]);

    const items = await prisma.workItem.findMany({ where: { userId: s.user.id, provider: 'JIRA' }, include: { sprint: true, project: true }, orderBy: { ticketKey: 'asc' } });
    expect(items.map((i) => i.ticketKey)).toEqual(['ER-1', 'ER-2', 'ER-3', 'OPS-9']); // OPS-10 on the shared board is excluded
    const byKey = Object.fromEntries(items.map((i) => [i.ticketKey, i]));
    expect(byKey['ER-1'].sprint?.name).toBe('Sprint 12');
    expect(byKey['ER-1'].isAssignedToMe).toBe(true);
    expect(byKey['ER-1'].externalUrl).toBe(`${BASE}/browse/ER-1`);
    expect(byKey['ER-2'].externalCompletedAt).not.toBeNull();
    expect(byKey['ER-3'].isAssignedToMe).toBe(false);
    expect(byKey['OPS-9'].project?.key).toBe('OPS');

    const sprints = await prisma.sprint.findMany({ where: { userId: s.user.id, provider: 'JIRA' } });
    expect(sprints.map((sp) => [sp.name, sp.status])).toEqual([['Sprint 12', 'ACTIVE']]);

    // Only GET requests, only to the Jira site, never the removed /rest/api/3/search endpoint.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/rest/api/3/search'))).toBe(false);
    // The one thing this whole test exists to prove: every real API call goes through the
    // gateway (api.atlassian.com), never the site domain directly — that's the exact bug
    // ("Client must be authenticated to access this resource") a scoped token hits otherwise.
    const gatewayCalls = calls.filter((c) => c.path.includes('/rest/'));
    expect(gatewayCalls.length).toBeGreaterThan(0);
    expect(gatewayCalls.every((c) => c.host === 'api.atlassian.com')).toBe(true);
    expect(calls.some((c) => c.host === 'acme.atlassian.net' && c.path === '/_edge/tenant_info')).toBe(true);
    expect(calls.find((c) => c.path.endsWith('/rest/api/3/search/jql'))?.query.get('jql')).toContain('assignee = currentUser()');

    const status = await s.get('/sync/status');
    expect(status.body.data.jira).toMatchObject({ status: 'CONNECTED', baseUrl: BASE, email: 'me@acme.com', lastError: null });

    // A second sync updates in place instead of duplicating.
    await s.post('/sync/jira');
    expect(await prisma.workItem.count({ where: { userId: s.user.id, provider: 'JIRA' } })).toBe(4);
  });

  it('disconnects and forgets the token but keeps synced tickets', async () => {
    const s = await loginAs();
    await s.post('/integrations/jira/connect', { baseUrl: BASE, email: 'me@acme.com', apiToken: 'good-token-123' });
    await s.post('/sync/jira');
    expect((await s.del('/integrations/jira')).status).toBe(200);
    expect(await prisma.oAuthToken.findUnique({ where: { userId_provider: { userId: s.user.id, provider: 'JIRA' } } })).toBeNull();
    expect((await prisma.jiraIntegration.findUnique({ where: { userId: s.user.id } }))?.status).toBe('DISCONNECTED');
    expect(await prisma.workItem.count({ where: { userId: s.user.id, provider: 'JIRA' } })).toBe(4);
    expect((await s.post('/sync/jira')).status).toBe(400);
  });
});
