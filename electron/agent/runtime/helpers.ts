import path from 'path';
import type { LLMToolCall } from '../../llm.js';
import type { PlanState } from '../../../src/shared/aiTypes.js';
import type { AgentPlanPhase, TaskRunSummary } from '../../../src/shared/types.js';
import type { AgentArtifact } from '../types.js';

export const CONTINUE_INTENT_RE = /^(继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试|continue|resume|retry)\s*[,，。！？.!?:;；：]*$/i;
export const LOCAL_PROJECT_PATH_RE = /[A-Za-z]:\\[^\r\n"'`<>|]+|\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g;
export const GITHUB_PROJECT_URL_RE = /https?:\/\/github\.com\/[^\s"'`<>]+/ig;
export const MAX_GENERIC_TURNS = 32;
export const MAX_AUTONOMOUS_REPAIRS = 5;

const TOOL_LABELS: Record<string, string> = {
  local_list_directory: '检查本地目录',
  local_read_file: '读取本地文件',
  local_write_file: '写入本地文件',
  local_exec: '执行本地命令',
  remote_exec: '执行远程命令',
  remote_list_directory: '检查远程目录',
  remote_read_file: '读取远程文件',
  remote_write_file: '写入远程文件',
  remote_upload_file: '上传文件到远程',
  remote_download_file: '下载远程文件',
  http_probe: '探测 HTTP 地址',
  service_inspect: '检查服务状态',
  service_control: '控制服务',
  task_create: '创建子任务',
  agent_fork: '启动子代理',
  todo_write: '更新任务清单',
  todo_read: '读取任务清单',
  git_clone_remote: '远程克隆仓库',
  git_fetch_remote: '远程更新仓库',
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

  return knownPaths.length > 0 ? knownPaths[knownPaths.length - 1] || null : null;
}

function summarizePrimaryArgument(args: Record<string, unknown>) {
  if (typeof args.command === 'string') return args.command;
  if (typeof args.goal === 'string') return args.goal;
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
