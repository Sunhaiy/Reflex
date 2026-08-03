import OpenAI from 'openai';
import type {
  CompletionEvents,
  CompletionRequest,
  CompletionResult,
  Message,
  Provider,
  ProviderConfig,
  StopReason,
  ToolCallPart,
  ToolDefinition,
} from './types';
import { ProviderError } from './types';

const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Every `/chat/completions` endpoint: OpenAI itself, OpenRouter, DashScope (千问),
 * Volcengine Ark (火山引擎), DeepSeek, and anything self-hosted that speaks the same
 * shape. They differ only in `baseUrl` and `model`.
 *
 * Two quirks are worth knowing about, because they are what makes this more than a
 * transcription of the OpenAI docs: tool-call arguments arrive as *fragments* that must
 * be reassembled by index across chunks, and several compatible endpoints hand back
 * `arguments` already parsed into an object instead of the JSON string the spec calls
 * for. Both are handled below.
 */
export class OpenAIProvider implements Provider {
  readonly kind = 'openai' as const;
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async complete(request: CompletionRequest, events: CompletionEvents): Promise<CompletionResult> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.flatMap(toOpenAIMessages),
          ],
          tools: request.tools.map(toOpenAITool),
          // `stream_options: {include_usage: true}` is deliberately not sent: several
          // compatible endpoints reject unknown fields outright, and losing the token
          // count is a far smaller problem than losing the request.
        },
        { signal: request.signal },
      );

      const partial = new Map<number, { id: string; name: string; args: string }>();
      let text = '';
      let finish: string | null = null;
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          events.onText(delta.content);
        }

        for (const call of delta?.tool_calls ?? []) {
          const slot = partial.get(call.index) ?? { id: '', name: '', args: '' };
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name = call.function.name;
          // Arguments arrive a few characters at a time and mean nothing until whole.
          if (call.function?.arguments) slot.args += call.function.arguments;
          partial.set(call.index, slot);
        }
      }

      const toolCalls: ToolCallPart[] = [];
      for (const [index, slot] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
        if (!slot.name) continue;
        const call: ToolCallPart = {
          type: 'tool_call',
          // Not every endpoint sends an id; the loop needs one to match the result to.
          id: slot.id || `call_${index}_${Date.now()}`,
          name: slot.name,
          input: parseArguments(slot.args, slot.name),
        };
        toolCalls.push(call);
        events.onToolCall(call);
      }

      return {
        text,
        toolCalls,
        stopReason: toStopReason(finish, toolCalls.length > 0),
        usage: usage ?? { inputTokens: 0, outputTokens: 0 },
      };
    } catch (error) {
      throw normaliseError(error, request.signal);
    }
  }
}

/**
 * Tolerates the two shapes seen in the wild — a JSON string per the spec, and an object
 * some compatible endpoints send instead — and refuses anything else loudly rather than
 * handing the tool an empty input it would act on.
 */
function parseArguments(raw: string, toolName: string): Record<string, unknown> {
  const text = raw.trim();
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

function toOpenAITool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** One message can become several: a tool turn carrying N results is N `tool` messages. */
function toOpenAIMessages(message: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'tool') {
    return message.parts
      .filter((part): part is Extract<typeof part, { type: 'tool_result' }> => part.type === 'tool_result')
      .map((part) => ({ role: 'tool' as const, tool_call_id: part.id, content: part.content }));
  }

  const text = message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');

  if (message.role === 'user') return [{ role: 'user', content: text }];

  const toolCalls = message.parts
    .filter((part): part is ToolCallPart => part.type === 'tool_call')
    .map((part) => ({
      id: part.id,
      type: 'function' as const,
      function: { name: part.name, arguments: JSON.stringify(part.input) },
    }));

  return [{
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }];
}

function toStopReason(finish: string | null, hasToolCalls: boolean): StopReason {
  if (finish === 'tool_calls' || hasToolCalls) return 'tool_use';
  if (finish === 'length') return 'max_tokens';
  return 'end';
}

function normaliseError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new ProviderError('Cancelled', undefined, false);
  if (error instanceof OpenAI.APIError) {
    const retryable = error.status === 429 || (error.status ?? 0) >= 500;
    return new ProviderError(error.message, error.status, retryable);
  }
  return error instanceof Error ? error : new ProviderError(String(error));
}
