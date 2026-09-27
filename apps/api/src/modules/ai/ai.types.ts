export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  toolName?: string;
  /** Provider-specific raw payload echoed back on the next turn (e.g. Gemini thought signatures). */
  raw?: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCallRequest[];
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown;
}

/** Every AI backend implements this. Providers never execute tools; the Tool Gateway does. */
export interface AIProvider {
  readonly name: 'GEMINI' | 'OPENROUTER' | 'OLLAMA';
  readonly isRemote: boolean;
  generate(messages: ChatMessage[]): Promise<GenerateResult>;
  generateWithTools(messages: ChatMessage[], tools: ToolSpec[]): Promise<GenerateResult>;
  stream(messages: ChatMessage[]): AsyncIterable<string>;
  /** Structural check only; argument validation is the gateway's job. */
  validateToolCall(call: unknown): call is ToolCallRequest;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export function isToolCallShape(call: unknown): call is ToolCallRequest {
  return typeof call === 'object' && call !== null && typeof (call as ToolCallRequest).name === 'string' && typeof (call as ToolCallRequest).id === 'string';
}
