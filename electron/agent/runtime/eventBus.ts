import type { AgentPlanPhase } from '../../../src/shared/types.js';
import type { AgentRuntimeMessage, AgentThreadSession } from '../types.js';
import { clip } from './helpers.js';

export class AgentEventBus {
  emitPlanUpdate(session: AgentThreadSession, planPhase: AgentPlanPhase | string) {
    if (session.webContents.isDestroyed()) return;
    session.webContents.send('agent-plan-update', {
      sessionId: session.id,
      planState: session.planState,
      planPhase,
      contextWindow: session.contextWindow,
      compressedMemory: session.compressedMemory,
      compressedRunMemory: session.compressedRunMemory,
      knownProjectPaths: session.knownProjectPaths,
      memoryFiles: session.memoryFiles,
      taskTodos: session.taskTodos,
      compactState: session.compactState,
      activeRunId: session.activeRunId,
      activeTaskRun: session.activeTaskRun,
    });
  }

  emitAssistantMessage(session: AgentThreadSession, message: AgentRuntimeMessage) {
    if (session.webContents.isDestroyed()) return;
    session.webContents.send('agent-push-msg', { sessionId: session.id, message });
  }

  emitToolResultMessage(
    session: AgentThreadSession,
    toolName: string,
    command: string,
    content: string,
    ok: boolean,
  ) {
    this.emitAssistantMessage(session, {
      id: `tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'tool',
      content: clip(content, 2200),
      timestamp: Date.now(),
      toolCall: {
        name: toolName,
        command,
        status: 'executed',
      },
      isError: !ok,
    });
  }
}
