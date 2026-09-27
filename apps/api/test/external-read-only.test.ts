import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyHttpClient } from '../src/modules/integrations/http/read-only-http-client';
import { ZOHO_READ_SCOPES } from '../src/modules/integrations/zoho/zoho.scopes';

const integrationsDir = fileURLToPath(new URL('../src/modules/integrations/', import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

// Anything that could issue a write request from provider code.
const FORBIDDEN = [
  /method\s*:/i,
  /\bfetch\s*\(/,
  /\.(post|put|patch|delete|request)\s*\(/i,
  /\baxios\b|\bgot\b|\bundici\b|node:https?|from\s+['"]https?['"]/,
  /graphql/i,
];

describe.each(['zoho', 'github'])('%s provider code is read-only', (provider) => {
  const files = tsFiles(join(integrationsDir, provider));

  it.each(files.length ? files : ['(no files yet)'])('%s has no write/HTTP primitives', (file) => {
    if (file === '(no files yet)') return;
    const src = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
  });
});

describe('provider interfaces', () => {
  it('expose only list*/get* methods', () => {
    const src = readFileSync(join(integrationsDir, 'providers.ts'), 'utf8');
    const methods = [...src.matchAll(/^\s+(\w+)\s*\(/gm)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(m).toMatch(/^(list|get)[A-Z]/);
  });
});

describe('ReadOnlyHttpClient', () => {
  it('has no public method other than get', () => {
    const methods = Object.getOwnPropertyNames(ReadOnlyHttpClient.prototype).filter((m) => m !== 'constructor');
    expect(methods).toEqual(['get']);
  });

  it('always sends GET and supports ETags', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { etag: '"x"' } }));
    const client = new ReadOnlyHttpClient({ allowedHosts: ['api.github.com'], authorization: async () => 'Bearer t', fetchImpl });
    const res = await client.get<{ a: number }>('https://api.github.com/user', { etag: '"old"' });
    expect(res).toEqual({ status: 200, data: { a: 1 }, etag: '"x"', rateLimitRemaining: null });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"old"');
  });

  it('refuses hosts outside the allowlist and non-https', async () => {
    const client = new ReadOnlyHttpClient({ allowedHosts: ['api.github.com'], authorization: async () => 'Bearer t', fetchImpl: vi.fn() });
    await expect(client.get('https://evil.example.com/x')).rejects.toThrow('Host not allowed');
    await expect(client.get('http://api.github.com/x')).rejects.toThrow('Host not allowed');
  });
});

describe('Zoho OAuth scopes', () => {
  it('request READ scopes only', () => {
    for (const s of ZOHO_READ_SCOPES) expect(s).toMatch(/\.READ$/);
    expect(ZOHO_READ_SCOPES.join(' ')).not.toMatch(/ALL|CREATE|UPDATE|DELETE|WRITE/);
  });
});
