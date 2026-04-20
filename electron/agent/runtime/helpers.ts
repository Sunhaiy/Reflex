import path from 'path';
import type { LLMToolCall } from '../../llm.js';
import type { PlanState } from '../../../src/shared/aiTypes.js';
import type { AgentPlanPhase, TaskRunSummary } from '../../../src/shared/types.js';
import type { AgentArtifact } from '../types.js';

const WINDOWS_LOCAL_PROJECT_PATH_RE = /(?:[A-Za-z]:\\|\\\\)[^\r\n"'`<>|,，。；：、]+(?: [^\r\n"'`<>|,，。；：、]+)*/g;
const POSIX_LOCAL_PROJECT_PATH_RE = /\/(?:Users|home|opt|srv|var|tmp)[^\s\r\n"'`<>|,，。；：、]*/g;

export const CONTINUE_INTENT_RE = /^(?:continue|resume|retry|go on|keep going|继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试)\s*[,，。！!?:;；：]*$/i;
export const STATUS_QUERY_RE = /^(?:status|what are you doing|what's the current status|what is the current status|你现在在干什么|现在在做什么|当前在做什么|当前进度|什么进度|啥进度)\s*[?？!！]*$/i;
export const OPTION_SELECTION_RE = /^(?:[ab]|[12]|option\s*[ab12]|方案\s*[ab]|选\s*[ab12])$/i;
export const LOCAL_PROJECT_PATH_RE = process.platform === 'win32'
  ? WINDOWS_LOCAL_PROJECT_PATH_RE
  : POSIX_LOCAL_PROJECT_PATH_RE;
export const GITHUB_PROJECT_URL_RE = /https?:\/\/github\.com\/[^\s"'`<>]+/ig;
export const MAX_GENERIC_TURNS = 96;
export const MAX_ROUTE_TURNS = 20;
export const MAX_AUTONOMOUS_REPAIRS = 5;
export const MAX_CONSECUTIVE_TOOL_FAILURES = 6;
export const MAX_LLM_RETRY_ATTEMPTS = 3;
export const MAX_AUTO_RESUME_ATTEMPTS = 4;
export const WATCHDOG_STALL_MS = 45000;
export const WATCHDOG_STAGNATION_LIMIT = 3;

const TOOL_LABELS: Record<string, string> = {
  local_list_directory: 'Inspect local directory',
  local_read_file: 'Read local file',
  local_write_file: 'Write local file',
  local_replace_in_file: 'Patch local file',
  local_apply_patch: 'Apply local patch',
  local_pack_archive: 'Pack local archive',
  local_exec: 'Run local command',
  remote_exec: 'Run remote command',
  remote_list_directory: 'Inspect remote directory',
  remote_read_file: 'Read remote file',
  remote_write_file: 'Write remote file',
  remote_replace_in_file: 'Patch remote file',
  remote_apply_patch: 'Apply remote patch',
  remote_upload_file: 'Upload file',
  remote_extract_archive: 'Extract remote archive',
  remote_download_file: 'Download file',
  http_probe: 'Probe HTTP endpoint',
  service_inspect: 'Inspect service',
  service_control: 'Control service',
  task_create: 'Create child task',
  agent_fork: 'Fork child agent',
  todo_write: 'Update todo list',
  todo_read: 'Read todo list',
  git_clone_remote: 'Clone remote repository',
  git_fetch_remote: 'Fetch remote repository',
};

export function now() {
  return Date.now();
}

export function clip(text: string, maxChars = 2000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function createPlanState(goal: string): PlanState {
  return {
    global_goal: goal,
    scratchpad: '',
    plan: [],
  };
}

export function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isContinueIntent(input: string) {
  return CONTINUE_INTENT_RE.test(input.trim());
}

export function isStatusQuery(input: string) {
  return STATUS_QUERY_RE.test(input.trim());
}

export function isOptionSelection(input: string) {
  return OPTION_SELECTION_RE.test(input.trim());
}

export function looksLikeSiteFollowUpGoal(input: string) {
  const lowered = input.toLowerCase();
  return (
    /\bhttps?:\/\/[^\s"'`<>]+/.test(lowered)
    || /\b[a-z0-9.-]+\.[a-z]{2,}\b/.test(lowered)
    || /\b(?:https|ssl|certbot|certificate|tls|domain|dns|nginx|server_name|proxy_pass)\b/.test(lowered)
    || /域名|证书|续签|网站|站点|解析|nginx|https|ssl|dns/.test(input)
  );
}

export function looksLikeDeploymentGoal(input: string) {
  const lowered = input.toLowerCase();
  return (
    /\b(?:deploy|redeploy|publish|ship|release|rollback|roll back|build|rebuild|start|restart|boot|run|serve|launch|bring up|expose|bind port|bind domain)\b/.test(lowered)
    || /\u90e8\u7f72|\u91cd\u65b0\u90e8\u7f72|\u53d1\u5e03|\u4e0a\u7ebf|\u56de\u6eda|\u6784\u5efa|\u91cd\u6784\u5efa|\u7f16\u8bd1|\u542f\u52a8|\u91cd\u542f|\u8dd1\u8d77\u6765|\u8fd0\u884c|\u63d0\u4f9b\u9759\u6001\u670d\u52a1|\u7ed1\u5b9a\u7aef\u53e3|\u6682\u505c|\u6062\u590d/.test(input)
  );
}

export function looksLikeProjectScopedGoal(input: string) {
  const lowered = input.toLowerCase();
  return (
    /\b(?:project|repo|repository|codebase|app|application|site|workspace)\b/.test(lowered)
    || /\b(?:this|that|current|previous)\s+(?:project|repo|app|site)\b/.test(lowered)
    || /\u8fd9\u4e2a\u9879\u76ee|\u8be5\u9879\u76ee|\u5f53\u524d\u9879\u76ee|\u521a\u624d\u90a3\u4e2a\u9879\u76ee|\u8fd9\u4e2a\u7ad9\u70b9|\u8be5\u7ad9\u70b9|\u8fd9\u4e2a\u5e94\u7528|\u8be5\u5e94\u7528|\u9879\u76ee|\u4ed3\u5e93|\u4ee3\u7801|\u7ad9\u70b9|\u5e94\u7528/.test(input)
  );
}

export function cleanDeployCandidate(input: string) {
  return input.trim().replace(/[),.;!?，。；：]+$/, '');
}

export function extractDeploySource(input: string, knownPaths: string[]): string | null {
  const githubMatches = input.match(GITHUB_PROJECT_URL_RE) || [];
  if (githubMatches.length > 0) {
    return cleanDeployCandidate(githubMatches[0] || '');
  }

  const localMatches = input.match(LOCAL_PROJECT_PATH_RE) || [];
  if (localMatches.length > 0) {
    const best = localMatches.sort((a, b) => b.length - a.length)[0];
    return best ? cleanDeployCandidate(best) : null;
  }

  return null;
}

function summarizePrimaryArgument(args: Record<string, unknown>) {
  if (typeof args.command === 'string') return args.command;
  if (typeof args.goal === 'string') return args.goal;
  if (typeof args.sourceDir === 'string' && typeof args.outFile === 'string') {
    return `${args.sourceDir} -> ${args.outFile}`;
  }
  if (typeof args.archivePath === 'string' && typeof args.targetDir === 'string') {
    return `${args.archivePath} -> ${args.targetDir}`;
  }
  if (typeof args.path === 'string') return args.path;
  if (typeof args.remotePath === 'string') {
    const localPath = typeof args.localPath === 'string' ? args.localPath : 'local';
    return `${localPath} -> ${args.remotePath}`;
  }
  if (typeof args.repoUrl === 'string') return args.repoUrl;
  if (typeof args.serviceName === 'string') {
    return `${typeof args.action === 'string' ? args.action : ''} ${args.serviceName}`.trim();
  }
  return '';
}

export function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const label = TOOL_LABELS[name] || name;
  const primaryArg = summarizePrimaryArgument(args);
  return primaryArg ? `${label}: ${primaryArg}` : label;
}

export function makeArtifact(title: string, content: string): AgentArtifact {
  const id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title,
    preview: clip(content.replace(/\s+\n/g, '\n').trim(), 1000),
    content,
    createdAt: Date.now(),
  };
}

export function phaseToPlanStatus(run: TaskRunSummary): AgentPlanPhase {
  if (run.status === 'completed') return 'done';
  if (run.status === 'retryable_paused' || run.status === 'paused') return 'paused';
  if (run.status === 'blocked' || run.phase === 'blocked') return 'blocked';
  if (run.status === 'failed') return 'stopped';
  if (run.phase === 'understand' || run.phase === 'inspect' || run.phase === 'hypothesize') return 'generating';
  return 'executing';
}

export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function sourceTypeFromLabel(label: string) {
  return /^https?:\/\/github\.com\//i.test(label) ? 'github' : 'local';
}

export function buildTaskRunId() {
  return `task-run-${now()}`;
}

export function summarizeToolCalls(toolCalls: LLMToolCall[] | undefined) {
  if (!toolCalls?.length) return '';
  return toolCalls.map((toolCall) => {
    const args = safeParseArgs(toolCall.function.arguments);
    return toolCallSummary(toolCall.function.name, args);
  }).join('\n');
}

export function normalizePathCandidate(candidate: string) {
  return candidate.includes('\\') ? path.normalize(candidate.trim()) : candidate.trim();
}
