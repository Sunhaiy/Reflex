import { callLLM } from '../../../llm.js';
import type { AgentThreadSession } from '../../types.js';
import { appendScratchpad, summarizeThreadMessages } from '../../prompts.js';
import { buildCompactSystemPrompt, buildCompactUserPrompt } from './prompt.js';

export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

function clip(text: string, maxChars = 6000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

export class AgentAutoCompactService {
  shouldCompact(session: AgentThreadSession) {
    if (session.compactState.paused) return false;
    if (session.history.length <= 10) return false;
    const historyTooLong = session.history.length > 20;
    const promptNearLimit = session.contextWindow.promptTokens >= session.contextWindow.limitTokens * 0.72;
    return historyTooLong || promptNearLimit;
  }

  async maybeCompact(session: AgentThreadSession) {
    if (!this.shouldCompact(session)) return false;

    const older = session.history.slice(0, -10);
    const newer = session.history.slice(-10);
    if (!older.length) return false;

    try {
      const summary = await callLLM(
        session.profile,
        [
          { role: 'system', content: buildCompactSystemPrompt(session) },
          { role: 'user', content: buildCompactUserPrompt(older) },
        ],
        {
          temperature: 0.1,
          maxTokens: 1400,
          signal: session.abortController?.signal,
        },
      );

      this.applyCompaction(session, newer, summary, older.length);
      return true;
    } catch (error: any) {
      session.compactState = {
        ...session.compactState,
        consecutiveFailures: session.compactState.consecutiveFailures + 1,
        paused: session.compactState.consecutiveFailures + 1 >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
      };

      const fallback = this.buildFallbackSummary(session, older);
      this.applyCompaction(session, newer, fallback, older.length, true);
      return true;
    }
  }

  private applyCompaction(
    session: AgentThreadSession,
    newer: typeof session.history,
    summary: string,
    olderCount: number,
    fallback = false,
  ) {
    session.compressedMemory = clip(
      session.compressedMemory ? `${session.compressedMemory}\n\n${summary.trim()}` : summary.trim(),
    );
    session.compressedRunMemory = clip(
      [
        session.activeTaskRun ? `Run goal: ${session.activeTaskRun.goal}` : '',
        session.activeTaskRun?.activeHypothesisId
          ? `Route: ${session.activeTaskRun.hypotheses.find((item) => item.id === session.activeTaskRun?.activeHypothesisId)?.kind || session.activeTaskRun.activeHypothesisId}`
          : '',
        session.activeTaskRun?.currentAction ? `Current action: ${session.activeTaskRun.currentAction}` : '',
        session.activeTaskRun?.failureHistory.length
          ? `Recent failure: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.failureClass}: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.message}`
          : '',
        session.taskTodos.length
          ? `Todos:\n${session.taskTodos.map((todo) => `- [${todo.status}] ${todo.content}`).join('\n')}`
          : '',
        summary.trim(),
      ]
        .filter(Boolean)
        .join('\n\n'),
      5000,
    );
    session.history = newer;
    session.contextWindow = {
      ...session.contextWindow,
      compressionCount: session.contextWindow.compressionCount + 1,
      autoCompressed: true,
      summaryChars: session.compressedMemory.length,
    };
    session.compactState = {
      lastCompactedAt: Date.now(),
      lastBoundaryMessageCount: olderCount,
      consecutiveFailures: fallback ? session.compactState.consecutiveFailures : 0,
      paused: fallback ? session.compactState.paused : false,
    };
    session.planState.scratchpad = appendScratchpad(
      session.planState.scratchpad,
      fallback ? 'Context auto-compressed with fallback summary' : 'Context auto-compressed with model summary',
    );
  }

  private buildFallbackSummary(session: AgentThreadSession, older: typeof session.history) {
    const olderSummary = summarizeThreadMessages(
      older.map((message, index) => ({
        role: message.role,
        content: `#${index + 1} ${String(message.content || '')}`,
      })),
    );
    return [
      `Goal: ${session.planState.global_goal}`,
      session.activeTaskRun?.currentAction ? `Current action: ${session.activeTaskRun.currentAction}` : '',
      session.activeTaskRun?.failureHistory.length
        ? `Recent failure: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.failureClass}: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.message}`
        : '',
      session.taskTodos.length
        ? `Todos:\n${session.taskTodos.map((todo) => `- [${todo.status}] ${todo.content}`).join('\n')}`
        : '',
      'Conversation handoff:',
      olderSummary.map((item) => `${item.role}: ${item.content}`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
