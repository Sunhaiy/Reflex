/**
 * The one shape every provider normalises to.
 *
 * Anthropic's Messages API and the OpenAI `/chat/completions` family disagree on almost
 * every detail — where tool schemas live, whether tool arguments arrive as an object or
 * a JSON string, how results are fed back, how a stream is framed. All of that is the
 * adapter's problem. The agent loop above this file sees only what is here, which is why
 * there is one loop, one approval gate and one event stream rather than one of each per
 * vendor.
 */

import type { ProviderKind } from '../../../src/shared/agent';

export type { ProviderKind };

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  /** Echoed back on the matching result; the wire format differs per provider. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultPart {
  type: 'tool_result';
  /** The `id` of the call this answers. */
  id: string;
  content: string;
  isError?: boolean;
}

export type MessagePart = TextPart | ToolCallPart | ToolResultPart;

/**
 * `tool` carries only tool_result parts. OpenAI splits those into one message each and
 * Anthropic folds them into a single user turn — the adapters handle that.
 */
export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  parts: MessagePart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the input object. */
  parameters: Record<string, unknown>;
}

/** Why the model stopped. `refusal` is Anthropic-specific; OpenAI reports it as `end`. */
export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'aborted';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

/**
 * Streamed as it arrives. `onToolCall` fires once a call is whole — a partially streamed
 * call is never surfaced, because the loop would have nothing to run.
 */
export interface CompletionEvents {
  onText(delta: string): void;
  onToolCall(call: ToolCallPart): void;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCallPart[];
  stopReason: StopReason;
  usage: TokenUsage;
}

export interface Provider {
  /** Identifies the adapter in logs, not the vendor: 'anthropic' or 'openai'. */
  readonly kind: ProviderKind;
  complete(request: CompletionRequest, events: CompletionEvents): Promise<CompletionResult>;
}


export interface ProviderConfig {
  kind: ProviderKind;
  /** Full origin plus version path, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Thrown when a provider rejects the request; the loop turns it into a visible error. */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'ProviderError';
  }
}
