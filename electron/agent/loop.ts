import { decide, type AgentMode } from './approval';
import { compactHistory, estimateTokens, foldOldest } from './context';
import { findTool, TOOL_DEFINITIONS, type ToolContext } from './tools';
import type { Message, MessagePart, Provider, ToolCallPart, ToolResultPart } from './providers/types';
import type { ApprovalAnswer, ApprovalQuestion } from '../../src/shared/agent';

export type { ApprovalAnswer, ApprovalQuestion };

export interface AgentEvents {
  /** The older half was folded into a summary; the panel says so. */
  onCompacted(): void;
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
  /** Tokens of history to carry before old tool output is dropped. */
  contextBudget?: number;
  signal: AbortSignal;
}

export interface RunOutcome {
  stopReason: 'done' | 'max_turns' | 'aborted';
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The history including this run, for the caller to carry into the next message. */
  messages: Message[];
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
    if (signal.aborted) return { stopReason: 'aborted', turns, usage, messages };
    turns += 1;

    // Dropping old output is tried first and costs nothing. Folding the conversation
    // into a summary is lossy and costs a request, so it only happens once trimming has
    // nothing left to take — and it rewrites the stored history, so it happens once
    // rather than on every subsequent turn.
    let outgoing = compactHistory(messages, { maxTokens: options.contextBudget });
    if (estimateTokens(outgoing) > (options.contextBudget ?? Infinity)) {
      const folded = await foldOldest(messages, (transcript) => summarise(provider, transcript, signal));
      if (folded !== messages) {
        messages.splice(0, messages.length, ...folded);
        outgoing = compactHistory(messages, { maxTokens: options.contextBudget });
        events.onCompacted();
      }
    }

    const result = await provider.complete(
      { system, messages: outgoing, tools: TOOL_DEFINITIONS, signal },
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

    if (result.toolCalls.length === 0) return { stopReason: 'done', turns, usage, messages };

    const results: ToolResultPart[] = [];
    for (const call of result.toolCalls) {
      if (signal.aborted) return { stopReason: 'aborted', turns, usage, messages };
      results.push(await executeCall(call, { mode, context, events, allowedGroups }));
    }

    messages.push({ role: 'tool', parts: results });
  }

  return { stopReason: 'max_turns', turns, usage, messages };
}

/**
 * Asks the same model to write the summary. No tools are offered: this is a reading
 * task, and a model handed a shell here would try to verify what it was summarising.
 */
async function summarise(provider: Provider, transcript: string, signal: AbortSignal): Promise<string> {
  const result = await provider.complete(
    {
      system: 'You are compacting the record of a server deployment so the work can '
        + 'continue without it. Write a brief for whoever picks this up: what was asked, '
        + 'what has been done and verified, what failed and why, what state the server is '
        + 'in now, and what is left. Keep every path, port, service name, package version '
        + 'and command that still matters — those cannot be recovered once this is gone. '
        + 'Drop the narration. Write prose, no preamble.',
      messages: [{ role: 'user', parts: [{ type: 'text', text: transcript }] }],
      tools: [],
      signal,
    },
    { onText: () => undefined, onToolCall: () => undefined },
  );
  return result.text;
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
