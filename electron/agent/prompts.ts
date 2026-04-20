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

function formatLongRangePlan(session: AgentThreadSession) {
  const items = session.activeTaskRun?.longRangePlan || [];
  if (!items.length) return '';
  return [
    'Long-range execution plan:',
    ...items.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');
}

function formatStrategyHistory(session: AgentThreadSession) {
  const items = session.activeTaskRun?.strategyHistory || [];
  if (!items.length) return '';
  return [
    'Recent strategy decisions:',
    ...items.slice(-4).map((item) => `- ${item.action}: ${item.summary} | ${item.reason}`),
  ].join('\n');
}

function formatExecutionGuidance(session: AgentThreadSession) {
  const run = session.activeTaskRun;
  if (!run?.repoAnalysis) return '';

  const route = run.activeHypothesisId
    ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)
    : run.hypotheses[0];
  if (!route) return '';

  const outputDir = run.repoAnalysis.outputDir || (route.kind === 'static-nginx' ? 'dist or build output' : undefined);
  const buildCommand = run.repoAnalysis.buildCommands[0];
  const startCommand = run.repoAnalysis.startCommands[0];
  const lines = ['Route execution guidance:'];

  if (run.source?.type === 'local') {
    lines.push('This source is local. Prefer one release archive over many per-file uploads whenever possible.');

    if (route.kind === 'static-nginx') {
      lines.push('For this local static-site route, install dependencies locally, run the local production build, pack only the built output directory into one archive, upload that single archive, extract it remotely, configure nginx, then verify with http_probe.');
      lines.push('Do not upload many dist/assets files one by one unless there is a strong reason.');
      lines.push('Preferred tools for this route: local_exec, local_pack_archive, remote_upload_file, remote_extract_archive, remote_write_file or remote_apply_patch, remote_exec, http_probe.');
    } else {
      lines.push('For this local deployment route, prefer packing the project or release artifact into one archive, uploading it once, and extracting it remotely before runtime wiring and verification.');
      lines.push('Avoid repetitive file-by-file transfer when a single archive would work.');
    }
  } else if (run.source?.type === 'github') {
    lines.push('This source is GitHub-based. Prefer remote checkout/fetch plus remote build/install steps instead of local packing.');
  }

  if (buildCommand) lines.push(`Known build command: ${buildCommand}`);
  if (startCommand) lines.push(`Known start command: ${startCommand}`);
  if (outputDir) lines.push(`Likely output directory: ${outputDir}`);

  return lines.join('\n');
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
    'You are Reflex Agent, a persistent task-running software engineer.',
    'Operate like a real agent: observe, form hypotheses, act, verify, repair, and continue until the task is completed or clearly blocked.',
    'Be highly autonomous. Do not ask the user for confirmation unless the action is clearly destructive or the missing information cannot be inferred safely.',
  ].join('\n');
}

function buildToolDisciplinePrompt() {
  return [
    'Use only the provided typed tools.',
    'Never invent ad-hoc transfer protocols, temporary HTTP upload servers, base64 chunking, or shell tricks when a tool already exists.',
    'Prefer local_replace_in_file or remote_replace_in_file for targeted text edits before rewriting an entire file.',
    'Prefer local_apply_patch or remote_apply_patch for multi-line code edits that need context-aware patching.',
    'Prefer local_pack_archive and remote_extract_archive when you need to transfer a local build or project release to the server.',
    'Prefer taking another concrete action over narrating what you might do next.',
    'For repository deployment tasks, inspect README, Docker/Compose files, runtime manifests, env examples, and remote environment signals before deciding a route.',
    'Prefer repository-native routes first: docker compose, Dockerfile, then language-native runtime routes.',
    'For local-source deployments, do not upload dozens of files one by one when one archive would transfer the same release more safely and clearly.',
    'For local frontend or static-site deployments, inspect the build command, run the local build first, archive the built output directory, upload one archive, extract it remotely, then configure nginx and verify externally.',
    'When a route fails, decide whether the route is wrong or the environment is incomplete. Repair the current route when possible; switch routes only when evidence disproves the current one.',
    'Run explicit self-checks during long tasks: verify the current assumptions, confirm the next milestone, and change strategy when failures repeat.',
    'For GitHub deployment tasks, work directly on the remote server: clone or fetch the repository remotely, inspect it there, and deploy from that remote checkout.',
    'If the user later asks to bind a domain, enable HTTPS, configure Certbot, or renew SSL for a site that was just deployed in this conversation, treat it as a follow-up on the last successfully deployed site unless the user explicitly names a different project.',
    'Use task_create for meaningful subproblems that should be tracked separately.',
    'Use agent_fork for scoped investigations or bounded subproblems when parallel reasoning or focused diagnosis would help.',
    'When you are truly blocked on user-provided information, credentials, secrets, or an irreversible decision, reply with exactly one short line that starts with ASK_USER: followed by the specific missing item.',
    'When you believe the deployment is complete, finish with a concise summary that includes a line in the form FINAL_URL: https://... or FINAL_URL: http://ip:port after a successful http_probe.',
  ].join('\n');
}

function buildVisibleThinkingPrompt() {
  return [
    'Expose your working state to the user as short visible thought updates.',
    'Before a tool call, include 1-3 concise sentences in the assistant content explaining what you just inferred, why this tool is the next useful action, and what result you expect to learn.',
    'After repeated failures or a strategy change, explicitly say what signal changed your mind and what tactic you are switching to.',
    'Keep these updates factual and operational. Do not write long private chain-of-thought; write the decision trace that helps the user follow your work.',
  ].join('\n');
}

function buildTaskManagementPrompt() {
  return [
    'Maintain a real task list for multi-step work.',
    'Keep a long-range execution plan in mind, not just the next tool call.',
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
  const scratchpad = session.planState?.scratchpad?.trim();
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
          run.repoAnalysis?.outputDir ? `Likely output directory: ${run.repoAnalysis.outputDir}` : '',
          run.repoAnalysis?.buildCommands?.length ? `Build commands: ${run.repoAnalysis.buildCommands.join(' | ')}` : '',
          run.repoAnalysis?.startCommands?.length ? `Start commands: ${run.repoAnalysis.startCommands.join(' | ')}` : '',
          run.currentAction ? `Current action: ${run.currentAction}` : '',
          run.selfCheckCount ? `Self-check rounds: ${run.selfCheckCount}` : '',
          run.watchdogState ? `Watchdog: ${run.watchdogState}, alerts=${run.watchdogAlerts || 0}, replays=${run.checkpointReplayCount || run.checkpoint.replayCount || 0}` : '',
          run.checkpoint.lastProgressNote ? `Last confirmed progress: ${clip(run.checkpoint.lastProgressNote, 500)}` : '',
          run.failureHistory.length
            ? `Recent failure: ${run.failureHistory[run.failureHistory.length - 1]?.failureClass} :: ${clip(run.failureHistory[run.failureHistory.length - 1]?.message || '', 500)}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    formatExecutionGuidance(session),
    formatLongRangePlan(session),
    formatStrategyHistory(session),
    formatTodos(session),
    formatChildRuns(session),
    session.memoryFiles.length
      ? `Loaded memory files: ${session.memoryFiles.map((item) => `${item.scope}:${item.title}`).join(', ')}`
      : '',
    scratchpad ? `Scratchpad:\n${clip(scratchpad, 2500)}` : '',
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
    buildVisibleThinkingPrompt(),
    buildTaskManagementPrompt(),
    session.memoryPrompt || '',
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    buildDynamicContext(session),
  ]
    .filter(Boolean)
    .join('\n\n');
}
