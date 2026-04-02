import type { LLMMessage } from '../llm.js';
import type { AgentThreadSession } from './types.js';

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '=== DYNAMIC RUNTIME CONTEXT ===';

function clip(text: string, maxChars = 1200) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function formatTodos(session: AgentThreadSession) {
  const todos = session.activeTaskRun?.taskTodos?.length
    ? session.activeTaskRun.taskTodos
    : session.taskTodos;
  if (!todos?.length) return '';
  return [
    'Current task list:',
    ...todos.map((item) => `- [${item.status}] ${item.content}`),
  ].join('\n');
}

function formatChildRuns(session: AgentThreadSession) {
  const childRuns = session.activeTaskRun?.childRuns || [];
  if (!childRuns.length) return '';
  return [
    'Tracked child tasks:',
    ...childRuns.map((item) => `- [${item.status}] ${item.title}: ${item.summary || item.lastAction || item.goal}`),
  ].join('\n');
}

export function appendScratchpad(existing: string, note?: string) {
  const next = (note || '').trim();
  if (!next) return existing;
  const lines = existing
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.includes(next)) return existing;
  return [...lines.slice(-14), next].join('\n');
}

export function makeArtifactPreview(content: string) {
  return clip(content.replace(/\s+\n/g, '\n').trim(), 1000);
}

export function summarizeThreadMessages(messages?: Array<{ role: string; content: string }>): LLMMessage[] {
  if (!messages?.length) return [];
  return messages
    .slice(-12)
    .filter((message) => message.content?.trim())
    .map((message) => ({
      role: message.role === 'tool' ? 'assistant' : message.role,
      content: clip(message.content, 1000),
    }));
}

function buildCorePrompt() {
  return [
    'You are Zangqing Agent, a persistent task-running software engineer.',
    'Operate like a real agent: observe, form hypotheses, act, verify, repair, and continue until the task is completed or clearly blocked.',
    'Be highly autonomous. Do not ask the user for confirmation unless the action is clearly destructive or the missing information cannot be inferred safely.',
  ].join('\n');
}

function buildToolDisciplinePrompt() {
  return [
    'Use only the provided typed tools.',
    'Never invent ad-hoc transfer protocols, temporary HTTP upload servers, base64 chunking, or shell tricks when a tool already exists.',
    'Prefer taking another concrete action over narrating what you might do next.',
    'For repository deployment tasks, inspect README, Docker/Compose files, runtime manifests, env examples, and remote environment signals before deciding a route.',
    'Prefer repository-native routes first: docker compose, Dockerfile, then language-native runtime routes.',
    'When a route fails, decide whether the route is wrong or the environment is incomplete. Repair the current route when possible; switch routes only when evidence disproves the current one.',
    'For GitHub deployment tasks, work directly on the remote server: clone or fetch the repository remotely, inspect it there, and deploy from that remote checkout.',
    'Use task_create for meaningful subproblems that should be tracked separately.',
    'Use agent_fork for scoped investigations or bounded subproblems when parallel reasoning or focused diagnosis would help.',
    'When you believe the deployment is complete, finish with a concise summary that includes a line in the form FINAL_URL: https://... or FINAL_URL: http://ip:port after a successful http_probe.',
  ].join('\n');
}

function buildTaskManagementPrompt() {
  return [
    'Maintain a real task list for multi-step work.',
    'Use todo_write when the task has more than one meaningful step, when you discover new subproblems, or when the task will likely take multiple tool calls.',
    'Use task_create before delegating or deeply investigating a subproblem so it becomes a tracked child task.',
    'Keep exactly one todo item in_progress at a time.',
    'Mark completed items promptly and keep pending items concise and action-oriented.',
    'Do not create a fake todo list for trivial one-step work.',
  ].join('\n');
}

function buildDynamicContext(session: AgentThreadSession) {
  const remote = session.remoteContext;
  const run = session.activeTaskRun;
  return [
    `Local context: cwd=${session.localContext.cwd}, desktop=${session.localContext.desktopDir}, platform=${session.localContext.platform}.`,
    remote
      ? `Remote context: host=${remote.host}, user=${remote.user}, pwd=${remote.pwd}, os=${remote.os}, node=${remote.node}, docker=${remote.docker}.`
      : '',
    run
      ? [
          `Active run goal: ${run.goal}`,
          `Active run phase/status: ${run.phase}/${run.status}`,
          run.activeHypothesisId ? `Active route: ${run.activeHypothesisId}` : '',
          run.hypotheses.length
            ? `Candidate routes: ${run.hypotheses.map((item) => `${item.kind}(${item.score.toFixed(2)})`).join(', ')}`
            : '',
          run.repoAnalysis
            ? `Repo analysis: ${run.repoAnalysis.framework}/${run.repoAnalysis.language}, packaging=${run.repoAnalysis.packaging}, confidence=${Math.round(run.repoAnalysis.confidence * 100)}%`
            : '',
          run.currentAction ? `Current action: ${run.currentAction}` : '',
          run.failureHistory.length
            ? `Recent failure: ${run.failureHistory[run.failureHistory.length - 1]?.failureClass} :: ${clip(run.failureHistory[run.failureHistory.length - 1]?.message || '', 500)}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    formatTodos(session),
    formatChildRuns(session),
    session.memoryFiles.length
      ? `Loaded memory files: ${session.memoryFiles.map((item) => `${item.scope}:${item.title}`).join(', ')}`
      : '',
    session.compressedRunMemory ? `Run memory:\n${clip(session.compressedRunMemory, 4000)}` : '',
    session.compressedMemory ? `Conversation memory:\n${clip(session.compressedMemory, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSystemPrompt(session: AgentThreadSession) {
  return [
    buildCorePrompt(),
    buildToolDisciplinePrompt(),
    buildTaskManagementPrompt(),
    session.memoryPrompt || '',
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    buildDynamicContext(session),
  ]
    .filter(Boolean)
    .join('\n\n');
}
