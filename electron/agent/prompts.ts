import type { LLMMessage } from '../llm.js';
import type { AgentThreadSession } from './types.js';

function clip(text: string, maxChars = 1200) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
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

export function buildSystemPrompt(session: AgentThreadSession) {
  const remote = session.remoteContext;
  return [
    'You are Zangqing Agent, a persistent task-running software engineer.',
    'You operate like a real agent: observe, form hypotheses, act, verify, repair, and continue until the task is completed or clearly blocked.',
    'You must be highly autonomous. Do not ask the user for confirmation unless the action is clearly destructive or the missing information cannot be inferred.',
    'Use only the provided typed tools. Never invent ad-hoc transfer protocols, temporary HTTP upload servers, base64 chunking, or shell tricks when a tool already exists.',
    'For repository deployment tasks, always inspect README, Docker/Compose files, runtime manifests, env examples, and remote environment signals before deciding a route.',
    'Prefer repository-native routes first: docker compose, Dockerfile, then language-native runtime routes.',
    'When a route fails, decide whether the route is wrong or the environment is incomplete. Repair the current route when possible; switch routes only when evidence disproves the current one.',
    'For GitHub deployment tasks, work directly on the remote server: clone or fetch the repository remotely, inspect it there, and deploy from that remote checkout. Do not route GitHub source through the local machine.',
    'Do not stop after analysis. Keep executing tools until you have either completed deployment and verified the external URL, or you are clearly blocked after repeated repair attempts.',
    'When you believe the deployment is complete, finish with a concise summary that includes a line in the form FINAL_URL: https://... or FINAL_URL: http://ip:port after a successful http_probe.',
    'Keep outputs concise and progress-oriented. Prefer taking another action over explaining what you might do next.',
    `Local context: cwd=${session.localContext.cwd}, desktop=${session.localContext.desktopDir}, platform=${session.localContext.platform}.`,
    remote
      ? `Remote context: host=${remote.host}, user=${remote.user}, pwd=${remote.pwd}, os=${remote.os}, node=${remote.node}, docker=${remote.docker}.`
      : '',
    session.activeTaskRun
      ? [
          `Active run goal: ${session.activeTaskRun.goal}`,
          `Active run phase/status: ${session.activeTaskRun.phase}/${session.activeTaskRun.status}`,
          session.activeTaskRun.activeHypothesisId ? `Active route: ${session.activeTaskRun.activeHypothesisId}` : '',
          session.activeTaskRun.hypotheses.length
            ? `Candidate routes: ${session.activeTaskRun.hypotheses.map((item) => `${item.kind}(${item.score.toFixed(2)})`).join(', ')}`
            : '',
          session.activeTaskRun.repoAnalysis
            ? `Repo analysis: ${session.activeTaskRun.repoAnalysis.framework}/${session.activeTaskRun.repoAnalysis.language}, packaging=${session.activeTaskRun.repoAnalysis.packaging}, confidence=${Math.round(session.activeTaskRun.repoAnalysis.confidence * 100)}%`
            : '',
          session.activeTaskRun.currentAction ? `Current action: ${session.activeTaskRun.currentAction}` : '',
          session.activeTaskRun.failureHistory.length
            ? `Recent failure: ${session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.failureClass} :: ${clip(session.activeTaskRun.failureHistory[session.activeTaskRun.failureHistory.length - 1]?.message || '', 500)}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    session.compressedMemory ? `Compressed memory:\n${clip(session.compressedMemory, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
