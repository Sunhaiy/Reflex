import Anthropic from '@anthropic-ai/sdk';
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

/**
 * An agent turn is "reason briefly, then call a tool" — the long text is in the tool
 * results coming back, which is input. Reserving 64k of output per turn would only pay
 * for a ceiling nothing reaches.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/** Anthropic's Messages API. */
export class AnthropicProvider implements Provider {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(private readonly config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async complete(request: CompletionRequest, events: CompletionEvents): Promise<CompletionResult> {
    try {
      const stream = this.client.messages.stream(
        {
          model: this.config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          // The system prompt and tool schemas are the same bytes every turn, and a
          // deployment runs dozens of turns over them. Caching that prefix is the single
          // biggest cost lever here.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          tools: request.tools.map(toAnthropicTool),
          messages: request.messages.map(toAnthropicMessage),
          // `thinking` is deliberately unset: the user may name any model here, and the
          // config that suits one errors on another. Omitting it runs adaptive thinking
          // on models where that is the default and no thinking elsewhere — never a 400.
        },
        { signal: request.signal },
      );

      stream.on('text', (delta: string) => events.onText(delta));

      const message = await stream.finalMessage();
      const toolCalls: ToolCallPart[] = [];
      let text = '';

      for (const block of message.content) {
        if (block.type === 'text') text += block.text;
        if (block.type === 'tool_use') {
          const call: ToolCallPart = {
            type: 'tool_call',
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          };
          toolCalls.push(call);
          events.onToolCall(call);
        }
      }

      return {
        text,
        toolCalls,
        stopReason: toStopReason(message.stop_reason),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    } catch (error) {
      throw normaliseError(error, request.signal);
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    // The SDK pages return async-iterable pages that follow the cursor themselves.
    for await (const model of await this.client.models.list()) ids.push(model.id);
    return ids.sort();
  }
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

/**
 * Tool results fold into a single user turn here. The OpenAI adapter has to split the
 * same list into one message each — this is the shape difference the unified protocol
 * exists to absorb.
 */
function toAnthropicMessage(message: Message): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const part of message.parts) {
    if (part.type === 'text') content.push({ type: 'text', text: part.text });
    if (part.type === 'tool_call') {
      content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
    }
    if (part.type === 'tool_result') {
      content.push({
        type: 'tool_result',
        tool_use_id: part.id,
        content: part.content,
        is_error: part.isError,
      });
    }
  }

  return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
}

function toStopReason(reason: string | null): StopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'refusal') return 'refusal';
  return 'end';
}

function normaliseError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new ProviderError('Cancelled', undefined, false);
  if (error instanceof Anthropic.APIError) {
    const retryable = error.status === 429 || (error.status ?? 0) >= 500;
    return new ProviderError(error.message, error.status, retryable);
  }
  return error instanceof Error ? error : new ProviderError(String(error));
}
