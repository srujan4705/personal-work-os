/**
 * The ONLY HTTP client Zoho and GitHub providers may use.
 * It has exactly one public method, get(), and always sends method GET.
 * There is deliberately no post/put/patch/delete — adding one fails
 * apps/api/test/external-read-only.test.ts.
 *
 * Note: OAuth token refresh (POST to the provider's accounts endpoint) is an
 * auth concern, not a data write, and lives in modules/integrations/oauth —
 * outside the provider folders scanned by the read-only test.
 */

export interface ReadOnlyResponse<T> {
  status: number;
  data: T | null; // null on 304 Not Modified / 204 No Content
  etag: string | null;
  rateLimitRemaining: number | null;
}

export class ProviderHttpError extends Error {
  override name = 'ProviderHttpError';
  constructor(
    readonly status: number,
    readonly host: string,
  ) {
    super(`Provider request to ${host} failed with ${status}`);
  }
}

export interface ReadOnlyHttpClientOptions {
  allowedHosts: readonly string[];
  authorization: () => Promise<string>; // e.g. "Zoho-oauthtoken <token>" or "Bearer <token>"
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ReadOnlyHttpClient {
  constructor(private readonly opts: ReadOnlyHttpClientOptions) {}

  async get<T>(
    url: string,
    init: { query?: Record<string, string | number | undefined>; etag?: string } = {},
  ): Promise<ReadOnlyResponse<T>> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !this.opts.allowedHosts.includes(u.hostname)) {
      throw new Error(`Host not allowed: ${u.hostname}`);
    }
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.opts.headers,
      Authorization: await this.opts.authorization(),
    };
    if (init.etag) headers['If-None-Match'] = init.etag;

    const res = await (this.opts.fetchImpl ?? fetch)(u, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });

    const remaining = res.headers.get('x-ratelimit-remaining');
    const rateLimitRemaining = remaining === null ? null : Number(remaining);
    if (res.status === 304) return { status: 304, data: null, etag: init.etag ?? null, rateLimitRemaining };
    if (!res.ok) throw new ProviderHttpError(res.status, u.hostname);
    if (res.status === 204) return { status: 204, data: null, etag: null, rateLimitRemaining };
    const body = await res.text();
    return { status: res.status, data: (body ? JSON.parse(body) : null) as T, etag: res.headers.get('etag'), rateLimitRemaining };
  }
}
