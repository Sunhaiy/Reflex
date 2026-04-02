import type { LLMMessage } from '../../../llm.js';
import type { AgentThreadSession } from '../../types.js';

function clip(text: string, maxChars = 1200) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function normalizeMessageContent(content: unknown) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function renderMessages(messages: LLMMessage[]) {
  return messages
    .map((message, index) => {
      const header = `#${index + 1} ${message.role}`;
      const content = clip(normalizeMessageContent(message.content), 900);
      return `${header}\n${content}`;
    })
    .join('\n\n');
}

export function buildCompactSystemPrompt(session: AgentThreadSession) {
  const route = session.activeTaskRun?.activeHypothesisId
    ? session.activeTaskRun.hypotheses.find((item) => item.id === session.activeTaskRun?.activeHypothesisId)?.kind
    : undefined;

  return [
    'You are generating a structured handoff summary for a long-running coding agent session.',
    'This is not a user-facing reply.',
    'Compress older conversation history while preserving the minimum state needed to resume the task with high reliability.',
    'Keep the summary factual and compact.',
    'Always preserve these sections when they exist:',
    '1. Goal',
    '2. Confirmed facts',
    '3. Active route or approach',
    '4. Files, paths, services, URLs, and ports that matter',
    '5. Failures, blockers, and what was already tried',
    '6. Open todos and unfinished work',
    '7. Next best action',
    '',
    `Current goal: ${session.planState.global_goal}`,
    route ? `Current route: ${route}` : '',
    session.activeTaskRun?.currentAction ? `Current action: ${session.activeTaskRun.currentAction}` : '',
    session.activeTaskRun?.failureHistory.length
      ? `Recent failure: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.failureClass}: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.message}`
      : '',
    session.taskTodos.length
      ? `Current todos:\n${session.taskTodos.map((todo) => `- [${todo.status}] ${todo.content}`).join('\n')}`
      : '',
    session.memoryPrompt ? `Loaded memory:\n${clip(session.memoryPrompt, 2000)}` : '',
    '',
    'Return plain text with short section headers. Do not use markdown tables or code fences.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCompactUserPrompt(messages: LLMMessage[]) {
  return [
    'Summarize the following older messages into a compact handoff summary.',
    'Older messages:',
    renderMessages(messages),
  ].join('\n\n');
}
