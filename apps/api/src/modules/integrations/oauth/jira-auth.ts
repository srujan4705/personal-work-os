import { prisma } from '../../../lib/prisma';
import { decryptSecret, encryptSecret } from '../../../lib/crypto';
import { badRequest } from '../../../lib/errors';
import { audit } from '../../audit/audit.service';
import { ReadOnlyHttpClient } from '../http/read-only-http-client';
import { resolveJiraCloudId, verifyJiraCredentials } from '../jira/jira.reader';

/**
 * Jira Cloud auth is a per-user personal API token (Basic: email + token), not OAuth —
 * there is no authorize/callback flow. The only non-GET-to-Jira concern here is none:
 * this file only stores/retrieves the encrypted credential locally.
 *
 * Every scoped API token (the "Create API token with scopes" kind, prefix ATATT) is
 * rejected by the site's own domain — it only works through Atlassian's gateway,
 * api.atlassian.com/ex/jira/{cloudId}. The cloud ID is resolved from the site once here
 * (and again at the start of every sync, rather than cached, to avoid a schema change
 * for a value that's cheap to re-fetch and never actually changes for a given site).
 */

const GATEWAY_HOST = 'api.atlassian.com';

function jiraHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    throw badRequest('JIRA_BAD_URL', 'That does not look like a valid Jira URL, e.g. https://yourcompany.atlassian.net');
  }
}

/** Verifies the credentials against Jira, then stores them encrypted. Called once, from Settings. */
export async function connectJira(userId: string, baseUrlInput: string, email: string, apiToken: string) {
  const baseUrl = baseUrlInput.replace(/\/+$/, '');
  const host = jiraHost(baseUrl);
  const http = new ReadOnlyHttpClient({
    allowedHosts: [host, GATEWAY_HOST],
    authorization: async () => `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
  });
  let verified: { accountId: string; displayName: string };
  try {
    const cloudId = await resolveJiraCloudId(http, baseUrl);
    verified = await verifyJiraCredentials(http, `https://${GATEWAY_HOST}/ex/jira/${cloudId}`);
  } catch {
    throw badRequest('JIRA_AUTH_FAILED', 'Could not sign in to Jira with that URL, email and API token.');
  }
  await prisma.$transaction([
    prisma.oAuthToken.upsert({
      where: { userId_provider: { userId, provider: 'JIRA' } },
      create: { userId, provider: 'JIRA', scopes: ['read'], accessTokenEnc: encryptSecret(`${email}:${apiToken}`) },
      update: { accessTokenEnc: encryptSecret(`${email}:${apiToken}`) },
    }),
    prisma.jiraIntegration.upsert({
      where: { userId },
      create: { userId, baseUrl, email, accountId: verified.accountId, status: 'CONNECTED', connectedAt: new Date() },
      update: { baseUrl, email, accountId: verified.accountId, status: 'CONNECTED', connectedAt: new Date(), lastError: null },
    }),
    prisma.userSettings.update({ where: { userId }, data: { jiraSyncEnabled: true } }),
  ]);
  await audit(userId, 'USER', 'integration.jira.connected', 'JiraIntegration', null, { baseUrl, email });
  return { displayName: verified.displayName };
}

/** Builds a ready-to-use reader client for an already-connected Jira account, routed through the API gateway. */
export async function getJiraClient(userId: string): Promise<{ http: ReadOnlyHttpClient; siteUrl: string; apiBase: string; accountId: string }> {
  const [token, integration] = await Promise.all([
    prisma.oAuthToken.findUnique({ where: { userId_provider: { userId, provider: 'JIRA' } } }),
    prisma.jiraIntegration.findUnique({ where: { userId } }),
  ]);
  if (!token || !integration || integration.status === 'DISCONNECTED' || !integration.accountId) {
    throw badRequest('JIRA_NOT_CONNECTED', 'Jira is not connected.');
  }
  const credentials = decryptSecret(token.accessTokenEnc); // "email:apiToken"
  const authorization = async () => `Basic ${Buffer.from(credentials).toString('base64')}`;
  const host = jiraHost(integration.baseUrl);
  const http = new ReadOnlyHttpClient({ allowedHosts: [host, GATEWAY_HOST], authorization });
  const cloudId = await resolveJiraCloudId(http, integration.baseUrl);
  return { http, siteUrl: integration.baseUrl, apiBase: `https://${GATEWAY_HOST}/ex/jira/${cloudId}`, accountId: integration.accountId };
}

export async function disconnectJira(userId: string) {
  await prisma.oAuthToken.deleteMany({ where: { userId, provider: 'JIRA' } });
  await prisma.jiraIntegration.updateMany({ where: { userId }, data: { status: 'DISCONNECTED' } });
  await prisma.userSettings.update({ where: { userId }, data: { jiraSyncEnabled: false } });
  await audit(userId, 'USER', 'integration.jira.disconnected', 'JiraIntegration');
}
