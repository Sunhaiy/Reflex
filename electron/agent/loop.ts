import { decide, type AgentMode } from './approval';
import { findTool, TOOL_DEFINITIONS, type ToolContext } from './tools';
import type { Message, MessagePart, Provider, ToolCallPart, ToolResultPart } from './providers/types';

/** What the user answered when asked to approve one call. */
export type ApprovalAnswer = 'allow' | 'always' | 'deny';

export interface ApprovalQuestion {
  callId: string;
  tool: string;
  command?: string;
  input: Record<string, unknown>;
  reason: string;
  /** Empty when this kind cannot be remembered; the UI hides "always allow" then. */
  group: string;
}

export interface AgentEvents {
  onText(delta: string): void;
  onToolStart(call: ToolCallPart): void;
  onToolOutput(callId: string, chunk: string): void;
  onToolEnd(callId: string, output: string, isError: boolean): void;
  onUsage(usage: { inputTokens: number; outputTokens: number }): void;
  ask(question: ApprovalQuestion): Promise<ApprovalAnswer>;
}

export interface RunOptions {
  provider: Provider;
  system: string;
  mode: AgentMode;
  context: ToolContext;
  events: AgentEvents;
  /** Stops a model that has started looping; each turn is one provider call. */
  maxTurns?: number;
  signal: AbortSignal;
}

export interface RunOutcome {
  stopReason: 'done' | 'max_turns' | 'aborted' | 'denied';
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
}

const DEFAULT_MAX_TURNS = 60;

/**
 * The agent loop: ask the model, run what it asked for, hand back the results, repeat
 * until it stops asking for tools.
 *
 * Written out rather than delegated to a vendor SDK's runner because the runners are
 * provider-specific, and one loop over the unified protocol is what keeps a single
 * approval gate and a single event stream across every provider.
 */
export async function runAgent(
  history: Message[],
  options: RunOptions,
): Promise<RunOutcome> {
  const { provider, system, mode, context, events, signal } = options;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  const messages = [...history];
  // Scoped to this run on purpose: "always allow npm" should not outlive the task it was
  // granted for.
  const allowedGroups = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let turns = 0;

  while (turns < maxTurns) {
    if (signal.aborted) return { stopReason: 'aborted', turns, usage };
    turns += 1;

    const result = await provider.complete(
      { system, messages, tools: TOOL_DEFINITIONS, signal },
      {
        onText: (delta) => events.onText(delta),
        onToolCall: (call) => events.onToolStart(call),
      },
    );

    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    events.onUsage(result.usage);

    const assistantParts: MessagePart[] = [];
    if (result.text) assistantParts.push({ type: 'text', text: result.text });
    assistantParts.push(...result.toolCalls);
    if (assistantParts.length > 0) messages.push({ role: 'assistant', parts: assistantParts });

    if (result.toolCalls.length === 0) return { stopReason: 'done', turns, usage };

    const results: ToolResultPart[] = [];
    for (const call of result.toolCalls) {
      if (signal.aborted) return { stopReason: 'aborted', turns, usage };
      results.push(await executeCall(call, { mode, context, events, allowedGroups }));
    }

    messages.push({ role: 'tool', parts: results });
  }

  return { stopReason: 'max_turns', turns, usage };
}

interface ExecuteDeps {
  mode: AgentMode;
  context: ToolContext;
  events: AgentEvents;
  allowedGroups: Set<string>;
}

/**
 * Runs one call, or refuses it. A refusal comes back as an ordinary tool result rather
 * than an exception: the model needs to read "the user declined" and choose another
 * approach, and killing the run would leave a half-finished deployment behind.
 */
async function executeCall(
  call: ToolCallPart,
  { mode, context, events, allowedGroups }: ExecuteDeps,
): Promise<ToolResultPart> {
  const command = typeof call.input.command === 'string' ? call.input.command : undefined;
  const decision = decide({ tool: call.name, command, mode, allowedGroups });

  if (decision.verdict === 'deny') {
    const message = `Refused: ${decision.reason}.`;
    events.onToolEnd(call.id, message, true);
    return { type: 'tool_result', id: call.id, content: message, isError: true };
  }

  if (decision.verdict === 'ask') {
    const answer = await events.ask({
      callId: call.id,
      tool: call.name,
      command,
      input: call.input,
      reason: decision.reason,
      group: decision.group,
    });

    if (answer === 'deny') {
      const message = 'The user declined this. Do not retry it; either work around it or ask them what to do instead.';
      events.onToolEnd(call.id, message, true);
      return { type: 'tool_result', id: call.id, content: message, isError: true };
    }
    if (answer === 'always' && decision.group) allowedGroups.add(decision.group);
  }

  const tool = findTool(call.name);
  if (!tool) {
    const message = `No such tool: ${call.name}`;
    events.onToolEnd(call.id, message, true);
    return { type: 'tool_result', id: call.id, content: message, isError: true };
  }

  try {
    const output = await tool.run(call.input, {
      ...context,
      report: (chunk) => events.onToolOutput(call.id, chunk),
    });
    events.onToolEnd(call.id, output, false);
    return { type: 'tool_result', id: call.id, content: output };
  } catch (error) {
    // A failing tool is information the model can act on, so it goes back as a result.
    const message = error instanceof Error ? error.message : String(error);
    events.onToolEnd(call.id, message, true);
    return { type: 'tool_result', id: call.id, content: `Error: ${message}`, isError: true };
  }
}
