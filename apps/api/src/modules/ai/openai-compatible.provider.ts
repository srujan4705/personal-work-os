import { env } from '../../config/env';
import { postJson } from './http';
import { AIProviderError, isToolCallShape, type AIProvider, type ChatMessage, type GenerateResult, type ToolSpec } from './ai.types';

interface OpenAIResponse {
  choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI-compatible chat completions. Used for OpenRouter (remote) and Ollama (local, /v1). */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly name: 'OPENROUTER' | 'OLLAMA',
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly headers: Record<string, string>,
    readonly isRemote: boolean,
  ) {}

  private async call(messages: ChatMessage[], tools?: ToolSpec[]): Promise<GenerateResult> {
    const res = await postJson<OpenAIResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        max_tokens: env.AI_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        messages: messages.map((m) => {
          if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
          if (m.role === 'assistant' && m.toolCalls?.length) {
            return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) };
          }
          return { role: m.role, content: m.content };
        }),
        ...(tools?.length && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
      },
      this.headers,
    );
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new AIProviderError('Empty response from AI provider', true);
    return {
      text: (msg.content ?? '').trim(),
      toolCalls: (msg.tool_calls ?? []).map((c) => {
        let args: unknown = {};
        try {
          args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          args = { __invalid_json__: true };
        }
        return { id: c.id, name: c.function.name, arguments: args };
      }),
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
    };
  }

  generate(messages: ChatMessage[]) {
    return this.call(messages);
  }
  generateWithTools(messages: ChatMessage[], tools: ToolSpec[]) {
    return this.call(messages, tools);
  }
  async *stream(messages: ChatMessage[]) {
    yield (await this.generate(messages)).text;
  }
  validateToolCall = isToolCallShape;
}
