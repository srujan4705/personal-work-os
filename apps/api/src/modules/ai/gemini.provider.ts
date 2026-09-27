import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { postJson } from './http';
import { isToolCallShape, type AIProvider, type ChatMessage, type GenerateResult, type ToolSpec } from './ai.types';

interface Part {
  text?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
  thoughtSignature?: string;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Gemini's function schema is an OpenAPI subset: strip keywords it rejects. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['$schema', 'additionalProperties', 'pattern', 'default', '$id', 'examples'].includes(k)) continue;
    if (k === 'format' && !['enum', 'date-time'].includes(String(v))) continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

export class GeminiProvider implements AIProvider {
  readonly name = 'GEMINI' as const;
  readonly isRemote = true;

  constructor(
    private readonly apiKey: string,
    private readonly model = env.GEMINI_MODEL,
  ) {}

  private async call(messages: ChatMessage[], tools?: ToolSpec[]): Promise<GenerateResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'assistant') return { role: 'model', parts: (m.raw as Part[] | undefined) ?? [{ text: m.content }] };
        if (m.role === 'tool') return { role: 'user', parts: [{ functionResponse: { name: m.toolName!, response: { content: m.content } } }] };
        return { role: 'user', parts: [{ text: m.content }] };
      });
    const res = await postJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        contents,
        ...(system && { systemInstruction: { parts: [{ text: system }] } }),
        ...(tools?.length && { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }] }),
        generationConfig: { maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS, temperature: 0.2 },
      },
      { 'x-goog-api-key': this.apiKey },
    );
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.map((p) => p.text ?? '').join('').trim(),
      toolCalls: parts.filter((p) => p.functionCall).map((p) => ({ id: randomUUID(), name: p.functionCall!.name, arguments: p.functionCall!.args ?? {} })),
      usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
      raw: parts,
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
