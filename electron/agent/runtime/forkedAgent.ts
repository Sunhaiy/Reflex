import { callLLMWithTools, type LLMMessage, type LLMToolCall } from '../../llm.js';
import { appendScratchpad } from '../prompts.js';
import { AgentSessionStore } from '../state/sessionStore.js';
import type { AgentToolDefinition, AgentThreadSession } from '../types.js';
import { now, safeParseArgs, serializeValue } from './helpers.js';

const READ_ONLY_TOOL_NAMES = new Set([
  'local_list_directory',
  'local_read_file',
  'remote_list_directory',
  'remote_read_file',
  'http_probe',
  'service_inspect',
  'todo_read',
  'task_create',
]);

function clip(text: string, maxChars = 1800) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function buildForkPrompt(
  session: AgentThreadSession,
  input: { title: string; goal: string; readOnly: boolean; maxTurns: number; lineageKey?: string },
) {
  const route = session.activeTaskRun?.activeHypothesisId
    ? session.activeTaskRun.hypotheses.find((item) => item.id === session.activeTaskRun?.activeHypothesisId)?.kind
    : undefined;
  return [
    'You are a forked child agent working on a narrowly scoped subtask.',
    'You are not the user-facing assistant.',
    'Work quickly, gather facts, and end with a concise handoff summary.',
    `Child task: ${input.title}`,
    `Goal: ${input.goal}`,
    `Mode: ${input.readOnly ? 'read-only investigation' : 'execution allowed'}`,
    `Parent goal: ${session.planState.global_goal}`,
    input.lineageKey ? `Fork lineage: ${input.lineageKey}` : '',
    route ? `Parent route: ${route}` : '',
    session.activeTaskRun?.currentAction ? `Parent action: ${session.activeTaskRun.currentAction}` : '',
    session.compressedRunMemory ? `Run memory:\n${clip(session.compressedRunMemory, 2600)}` : '',
    session.memoryPrompt ? `Memory files:\n${clip(session.memoryPrompt, 2000)}` : '',
    `You may take up to ${input.maxTurns} turns.`,
    'Return plain text. Include concrete findings, files or commands touched, blockers, and a recommended next action.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export class AgentForkedAgentService {
  constructor(
    private toolRegistry: AgentToolDefinition,
    private store: AgentSessionStore,
  ) {}

  async run(
    session: AgentThreadSession,
    input: { title: string; goal: string; readOnly: boolean; maxTurns: number },
  ) {
    const childRun = this.store.createChildRun(session, {
      title: input.title,
      goal: input.goal,
      mode: 'fork',
    });
    this.store.updateChildRun(session, childRun.id, {
      status: 'running',
      lastAction: 'Forked child agent started',
    });

    const allowedNames = new Set(
      this.toolRegistry.definitions
        .map((tool) => tool.function.name)
        .filter((name) => name !== 'agent_fork' && (input.readOnly ? READ_ONLY_TOOL_NAMES.has(name) : true)),
    );
    const tools = this.toolRegistry.definitions.filter((tool) => allowedNames.has(tool.function.name));
    const history: LLMMessage[] = [
      { role: 'system', content: buildForkPrompt(session, { ...input, lineageKey: childRun.lineageKey }) },
      { role: 'user', content: input.goal },
    ];

    let lastAssistantText = '';
    for (let turn = 1; turn <= input.maxTurns; turn += 1) {
      this.store.updateChildRun(session, childRun.id, {
        lastAction: `Fork turn ${turn}/${input.maxTurns}`,
      });

      const response = await callLLMWithTools(
        session.profile,
        history,
        tools,
        {
          temperature: 0.1,
          maxTokens: 1400,
          signal: session.abortController?.signal,
        },
      );

      if (response.content?.trim()) {
        lastAssistantText = response.content.trim();
        history.push({ role: 'assistant', content: lastAssistantText });
      }

      if (!response.toolCalls?.length) {
        const summary = lastAssistantText || 'Child agent finished without additional output.';
        this.store.updateChildRun(session, childRun.id, {
          status: 'completed',
          summary,
          lastAction: 'Child agent completed',
        });
        session.planState.scratchpad = appendScratchpad(
          session.planState.scratchpad,
          `Forked child agent ${input.title} completed`,
        );
        return {
          childRun: {
            ...childRun,
            status: 'completed' as const,
            summary,
            lastAction: 'Child agent completed',
            updatedAt: now(),
          },
          summary,
        };
      }

      history.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });
      const results = await this.executeToolCalls(session, response.toolCalls, input.readOnly);
      for (const result of results) {
        history.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.payload,
        });
      }
    }

    const failure = `Child agent ${input.title} reached its turn budget before producing a final handoff summary.`;
    this.store.updateChildRun(session, childRun.id, {
      status: 'failed',
      error: failure,
      lastAction: 'Child agent stopped at turn limit',
    });
    return {
      childRun: {
        ...childRun,
        status: 'failed' as const,
        error: failure,
        lastAction: 'Child agent stopped at turn limit',
        updatedAt: now(),
      },
      summary: failure,
    };
  }

  private async executeToolCalls(
    session: AgentThreadSession,
    toolCalls: LLMToolCall[],
    readOnly: boolean,
  ) {
    const executable = toolCalls.filter((toolCall) => toolCall.function.name !== 'agent_fork');
    const runOne = async (toolCall: LLMToolCall) => {
      const args = safeParseArgs(toolCall.function.arguments);
      const result = await this.toolRegistry.execute(toolCall.function.name, args, session);
      return {
        toolCallId: toolCall.id,
        payload: serializeValue(result.structured),
      };
    };
    if (readOnly && executable.every((toolCall) => READ_ONLY_TOOL_NAMES.has(toolCall.function.name))) {
      return Promise.all(executable.map(runOne));
    }
    const results = [];
    for (const toolCall of executable) {
      results.push(await runOne(toolCall));
    }
    return results;
  }
}
