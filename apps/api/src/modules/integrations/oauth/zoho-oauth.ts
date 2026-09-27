import { prisma } from '../../../lib/prisma';
import { env } from '../../../config/env';
import { decryptSecret, encryptSecret } from '../../../lib/crypto';
import { AppError, badRequest } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import { audit } from '../../audit/audit.service';
import { ZOHO_ACCOUNT_HOSTS, zohoHosts, type ZohoDataCenter } from '../zoho/zoho.domains';
import { ZOHO_READ_SCOPES } from '../zoho/zoho.scopes';

/**
 * OAuth for Zoho. The only non-GET calls to Zoho in the codebase live here, and they
 * are token exchanges with the ACCOUNTS server — never writes to Zoho data.
 */

export function zohoConfigured(): boolean {
  return !!(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REDIRECT_URI);
}

function requireConfig() {
  if (!zohoConfigured()) throw new AppError(503, 'ZOHO_NOT_CONFIGURED', 'Zoho is not configured. See docs/MANUAL_SETUP.md, section H.');
  return { clientId: env.ZOHO_CLIENT_ID!, clientSecret: env.ZOHO_CLIENT_SECRET!, redirectUri: env.ZOHO_REDIRECT_URI! };
}

export function buildAuthorizeUrl(state: string): string {
  const cfg = requireConfig();
  const u = new URL(`https://${zohoHosts(env.ZOHO_DATA_CENTER).accounts}/oauth/v2/auth`);
  u.search = new URLSearchParams({
    scope: ZOHO_READ_SCOPES.join(','),
    client_id: cfg.clientId,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    redirect_uri: cfg.redirectUri,
    state,
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_domain?: string;
  scope?: string;
  error?: string;
}

async function tokenRequest(accountsHost: string, params: Record<string, string>): Promise<TokenResponse> {
  if (!ZOHO_ACCOUNT_HOSTS.includes(accountsHost)) throw badRequest('ZOHO_BAD_ACCOUNTS_HOST', 'Unexpected Zoho accounts server.');
  const res = await fetch(`https://${accountsHost}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    throw new AppError(502, 'ZOHO_TOKEN_ERROR', `Zoho token request failed${body.error ? `: ${body.error}` : ''}.`);
  }
  return body;
}

export async function completeAuthorization(userId: string, code: string, accountsServer?: string) {
  const cfg = requireConfig();
  const dc: ZohoDataCenter = env.ZOHO_DATA_CENTER;
  const accountsHost = accountsServer ? new URL(accountsServer).hostname : zohoHosts(dc).accounts;
  const tokens = await tokenRequest(accountsHost, {
    grant_type: 'authorization_code', code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
  });
  const scopes = (tokens.scope ?? ZOHO_READ_SCOPES.join(',')).split(/[ ,]+/).filter(Boolean);
  if (scopes.some((s) => !/\.READ$/i.test(s))) {
    throw badRequest('ZOHO_SCOPE_REJECTED', 'Zoho granted non-read scopes. Personal Work OS only accepts READ scopes.');
  }
  await prisma.$transaction([
    prisma.oAuthToken.upsert({
      where: { userId_provider: { userId, provider: 'ZOHO' } },
      create: {
        userId, provider: 'ZOHO', scopes,
        accessTokenEnc: encryptSecret(tokens.access_token!),
        refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
      update: {
        scopes,
        accessTokenEnc: encryptSecret(tokens.access_token!),
        ...(tokens.refresh_token && { refreshTokenEnc: encryptSecret(tokens.refresh_token) }),
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
    }),
    prisma.zohoIntegration.upsert({
      where: { userId },
      create: { userId, dataCenter: dc, accountsUrl: accountsHost, apiDomain: tokens.api_domain ?? '', status: 'CONNECTED', connectedAt: new Date() },
      update: { dataCenter: dc, accountsUrl: accountsHost, apiDomain: tokens.api_domain ?? '', status: 'CONNECTED', connectedAt: new Date(), lastError: null },
    }),
    prisma.userSettings.update({ where: { userId }, data: { zohoSyncEnabled: true } }),
  ]);
  await audit(userId, 'USER', 'integration.zoho.connected', 'ZohoIntegration', null, { scopes });
}

export async function getZohoAccessToken(userId: string): Promise<string> {
  const [token, integration] = await Promise.all([
    prisma.oAuthToken.findUnique({ where: { userId_provider: { userId, provider: 'ZOHO' } } }),
    prisma.zohoIntegration.findUnique({ where: { userId } }),
  ]);
  if (!token || !integration || integration.status === 'DISCONNECTED') throw badRequest('ZOHO_NOT_CONNECTED', 'Zoho is not connected.');
  if (token.expiresAt && token.expiresAt.getTime() - 60_000 > Date.now()) return decryptSecret(token.accessTokenEnc);
  if (!token.refreshTokenEnc) throw badRequest('ZOHO_REAUTH_REQUIRED', 'Zoho session expired. Reconnect Zoho in Settings.');
  const cfg = requireConfig();
  const refreshed = await tokenRequest(integration.accountsUrl, {
    grant_type: 'refresh_token', refresh_token: decryptSecret(token.refreshTokenEnc), client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  await prisma.oAuthToken.update({
    where: { id: token.id },
    data: { accessTokenEnc: encryptSecret(refreshed.access_token!), expiresAt: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000) },
  });
  return refreshed.access_token!;
}

/** Revokes the refresh token at Zoho (auth endpoint) and removes local tokens. Synced snapshots are kept. */
export async function disconnectZoho(userId: string) {
  const [token, integration] = await Promise.all([
    prisma.oAuthToken.findUnique({ where: { userId_provider: { userId, provider: 'ZOHO' } } }),
    prisma.zohoIntegration.findUnique({ where: { userId } }),
  ]);
  if (token?.refreshTokenEnc && integration) {
    try {
      await fetch(`https://${integration.accountsUrl}/oauth/v2/token/revoke?token=${encodeURIComponent(decryptSecret(token.refreshTokenEnc))}`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn({ err }, 'zoho.revoke_failed');
    }
  }
  await prisma.oAuthToken.deleteMany({ where: { userId, provider: 'ZOHO' } });
  await prisma.zohoIntegration.updateMany({ where: { userId }, data: { status: 'DISCONNECTED' } });
  await prisma.userSettings.update({ where: { userId }, data: { zohoSyncEnabled: false } });
  await audit(userId, 'USER', 'integration.zoho.disconnected', 'ZohoIntegration');
}
