import OpenAI from 'openai';
import type { ToolCallPart } from './types';
import { ProviderError } from './types';

/**
 * Compatible gateways occasionally return already-parsed arguments even though both
 * OpenAI protocols specify a JSON string. Keep the tolerance in one place so the
 * Chat Completions and Responses adapters behave identically.
 */
export function parseOpenAIArguments(raw: unknown, toolName: string): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('not an object');
  } catch {
    throw new ProviderError(
      `Model sent malformed arguments for ${toolName}: ${text.slice(0, 200)}`,
    );
  }
}

export function normaliseOpenAIError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new ProviderError('Cancelled', undefined, false);
  if (error instanceof OpenAI.APIError) {
    const retryable = error.status === 429 || (error.status ?? 0) >= 500;
    return new ProviderError(error.message, error.status, retryable);
  }
  return error instanceof Error ? error : new ProviderError(String(error));
}

export function emitToolCall(
  call: ToolCallPart,
  calls: ToolCallPart[],
  seen: Set<string>,
  onToolCall: (call: ToolCallPart) => void,
) {
  if (seen.has(call.id)) return;
  seen.add(call.id);
  calls.push(call);
  onToolCall(call);
}
