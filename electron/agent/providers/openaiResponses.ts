import OpenAI from 'openai';
import type {
  CompletionEvents,
  CompletionRequest,
  CompletionResult,
  Message,
  Provider,
  ProviderConfig,
  ToolCallPart,
  ToolDefinition,
} from './types';
import { ProviderError } from './types';
import {
  emitToolCall,
  normaliseOpenAIError,
  parseOpenAIArguments,
} from './openaiCommon';

const MAX_OUTPUT_TOKENS = 16_000;

type PartialCall = {
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  index: number;
};

/**
 * OpenAI Responses adapter used by Sub2API and other Responses-compatible gateways.
 *
 * History is replayed as plain messages, function calls and function call outputs. It
 * intentionally does not replay provider-owned reasoning item IDs: Sub2API's OAuth
 * route uses `store: false`, so those IDs are not durable across requests.
 */
export class OpenAIResponsesProvider implements Provider {
  readonly kind = 'openai' as const;
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async complete(request: CompletionRequest, events: CompletionEvents): Promise<CompletionResult> {
    try {
      const stream = await this.client.responses.create(
        {
          model: this.config.model,
          instructions: request.system,
          input: request.messages.flatMap(toResponsesInput),
          tools: request.tools.map(toResponsesTool),
          max_output_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          store: false,
          ...(this.config.effort !== 'auto'
            ? { reasoning: { effort: this.config.effort } }
            : {}),
        },
        { signal: request.signal },
      );

      const partial = new Map<string, PartialCall>();
      const toolCalls: ToolCallPart[] = [];
      const seenCallIds = new Set<string>();
      let text = '';
      let finalResponse: OpenAI.Responses.Response | undefined;

      const remember = (
        item: OpenAI.Responses.ResponseFunctionToolCall,
        index: number,
      ): PartialCall => {
        const itemId = item.id || item.call_id || `item_${index}`;
        const slot = partial.get(itemId) ?? {
          itemId,
          callId: '',
          name: '',
          arguments: '',
          index,
        };
        slot.callId = item.call_id || slot.callId;
        slot.name = item.name || slot.name;
        slot.arguments = item.arguments || slot.arguments;
        slot.index = index;
        partial.set(itemId, slot);
        return slot;
      };

      const finishCall = (slot: PartialCall) => {
        if (!slot.name) return;
        const call: ToolCallPart = {
          type: 'tool_call',
          id: slot.callId || slot.itemId || `call_${slot.index}_${Date.now()}`,
          name: slot.name,
          input: parseOpenAIArguments(slot.arguments, slot.name),
        };
        emitToolCall(call, toolCalls, seenCallIds, events.onToolCall);
      };

      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
          case 'response.refusal.delta':
            text += event.delta;
            events.onText(event.delta);
            break;

          case 'response.output_item.added':
            if (event.item.type === 'function_call') remember(event.item, event.output_index);
            break;

          case 'response.function_call_arguments.delta': {
            const slot = partial.get(event.item_id) ?? {
              itemId: event.item_id,
              callId: '',
              name: '',
              arguments: '',
              index: event.output_index,
            };
            slot.arguments += event.delta;
            partial.set(event.item_id, slot);
            break;
          }

          case 'response.function_call_arguments.done': {
            const slot = partial.get(event.item_id) ?? {
              itemId: event.item_id,
              callId: '',
              name: '',
              arguments: '',
              index: event.output_index,
            };
            slot.name = event.name || slot.name;
            slot.arguments = event.arguments || slot.arguments;
            partial.set(event.item_id, slot);
            break;
          }

          case 'response.output_item.done':
            if (event.item.type === 'function_call') finishCall(remember(event.item, event.output_index));
            break;

          case 'response.completed':
          case 'response.incomplete':
            finalResponse = event.response;
            break;

          case 'response.failed':
            throw new ProviderError(event.response.error?.message || 'Response failed');

          case 'error':
            throw new ProviderError(event.message);
        }
      }

      // A few compatible gateways omit output_item.done but include calls in the final
      // response. Read both sources, then finish any remaining partial calls.
      for (const [index, item] of (finalResponse?.output ?? []).entries()) {
        if (item.type === 'function_call') finishCall(remember(item, index));
      }
      for (const slot of [...partial.values()].sort((a, b) => a.index - b.index)) {
        finishCall(slot);
      }

      const usage = finalResponse?.usage;
      return {
        text,
        toolCalls,
        stopReason: toolCalls.length > 0
          ? 'tool_use'
          : finalResponse?.incomplete_details?.reason === 'max_output_tokens'
            ? 'max_tokens'
            : 'end',
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
        },
      };
    } catch (error) {
      throw normaliseOpenAIError(error, request.signal);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      return await listModelIds(this.client);
    } catch (error) {
      // Sub2API exposes both bare Responses routes and the standard /v1 routes. When a
      // user pasted the bare origin from Codex config, model discovery still belongs at
      // /v1/models.
      if (error instanceof OpenAI.APIError && error.status === 404 && !/\/v1\/?$/i.test(this.config.baseUrl)) {
        const fallback = new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: `${this.config.baseUrl.replace(/\/+$/, '')}/v1`,
        });
        return listModelIds(fallback);
      }
      throw error;
    }
  }
}

async function listModelIds(client: OpenAI): Promise<string[]> {
  const ids: string[] = [];
  for await (const model of await client.models.list()) ids.push(model.id);
  return ids.sort();
}

export function toResponsesTool(tool: ToolDefinition): OpenAI.Responses.FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}

export function toResponsesInput(message: Message): OpenAI.Responses.ResponseInputItem[] {
  if (message.role === 'tool') {
    return message.parts
      .filter((part): part is Extract<typeof part, { type: 'tool_result' }> => part.type === 'tool_result')
      .map((part) => ({
        type: 'function_call_output' as const,
        call_id: part.id,
        output: part.content,
      }));
  }

  const text = message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');

  if (message.role === 'user') {
    return text ? [{ role: 'user', content: text }] : [];
  }

  const input: OpenAI.Responses.ResponseInputItem[] = [];
  if (text) input.push({ role: 'assistant', content: text });
  for (const part of message.parts) {
    if (part.type !== 'tool_call') continue;
    input.push({
      type: 'function_call',
      call_id: part.id,
      name: part.name,
      arguments: JSON.stringify(part.input),
    });
  }
  return input;
}
