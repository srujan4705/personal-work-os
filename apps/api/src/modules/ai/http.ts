import { env } from '../../config/env';
import { AIProviderError } from './ai.types';

/** POST JSON to an AI provider with timeout and bounded retries on 429/5xx. */
export async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  let lastError: AIProviderError | undefined;
  for (let attempt = 0; attempt <= env.AI_RETRY_LIMIT; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new AIProviderError(`AI provider returned HTTP ${res.status}`, retryable);
      if (!retryable) throw lastError;
    } catch (err) {
      if (err instanceof AIProviderError && !err.retryable) throw err;
      lastError = err instanceof AIProviderError ? err : new AIProviderError('AI provider unreachable or timed out', true);
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw lastError ?? new AIProviderError('AI provider failed', false);
}
