import { env } from '../../config/env';
import type { UserSettings } from '../../generated/prisma/client';
import type { AIProvider } from './ai.types';
import { GeminiProvider } from './gemini.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';

export type ProviderResolution = { provider: AIProvider } | { provider: null; reason: string };

let override: ((s: UserSettings) => ProviderResolution) | undefined;
/** Tests inject a fake provider here. */
export const setAiProviderOverride = (fn: typeof override) => {
  override = fn;
};

export function resolveAiProvider(settings: UserSettings): ProviderResolution {
  if (override) return override(settings);
  if (!settings.aiEnabled || settings.aiProvider === 'NONE') return { provider: null, reason: 'AI is disabled in Settings.' };
  if (settings.aiDataMode === 'LOCAL_ONLY' && settings.aiProvider !== 'OLLAMA') {
    return { provider: null, reason: 'LOCAL_ONLY data mode only allows the local Ollama provider.' };
  }
  switch (settings.aiProvider) {
    case 'GEMINI':
      return env.GEMINI_API_KEY ? { provider: new GeminiProvider(env.GEMINI_API_KEY) } : { provider: null, reason: 'GEMINI_API_KEY is not set.' };
    case 'OPENROUTER':
      return env.OPENROUTER_API_KEY
        ? { provider: new OpenAICompatibleProvider('OPENROUTER', 'https://openrouter.ai/api/v1', env.OPENROUTER_MODEL, { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'HTTP-Referer': env.APP_URL, 'X-Title': 'Personal Work OS' }, true) }
        : { provider: null, reason: 'OPENROUTER_API_KEY is not set.' };
    case 'OLLAMA':
      return { provider: new OpenAICompatibleProvider('OLLAMA', `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`, env.OLLAMA_MODEL, {}, false) };
  }
}
