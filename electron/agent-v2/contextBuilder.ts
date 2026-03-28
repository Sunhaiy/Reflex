import { AgentArtifact, AgentThreadSession } from './types.js';

function clip(text: string, maxChars = 800): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function buildSystemPrompt(session: AgentThreadSession): string {
  const remote = session.remoteContext
    ? [
        `远程主机: ${session.remoteContext.host}`,
        `远程用户: ${session.remoteContext.user}`,
        `远程目录: ${session.remoteContext.pwd}`,
        `远程系统: ${session.remoteContext.os}`,
        `Node: ${session.remoteContext.node}`,
        `Docker: ${session.remoteContext.docker}`,
      ].join('\n')
    : '远程环境: 尚未探测';

  const knownProjects = session.knownProjectPaths.length
    ? session.knownProjectPaths.map((item) => `- ${item}`).join('\n')
    : '- 暂无';

  return [
    '你是 SSH Tool 的 Agent V2 运行时，目标是像 Codex 一样持续行动直到任务真正完成。',
    '你可以同时操作本地机器和远程服务器。',
    '优先使用工具，不要空谈；除非缺少密钥、账号、不可逆决策，否则不要向用户追问。',
    '部署任务的优先顺序是：先分析本地项目，再探测远程环境，再补齐依赖环境，再部署，再修错，再验证，最后只把结果告诉用户。',
    '遇到错误时先自我修复：读取日志、检查配置、调整命令、重试。只有在确实缺少用户无法替代的信息时才暂停。',
    '上下文要节制使用：不要重复读取同一个大文件；大型输出会变成 artifact，只引用摘要。',
    '对于部署任务，优先使用 deploy_project 工具，并且必须先判断项目类型，再选择合适路线：静态站点、本地构建产物上传；服务端项目，按服务端发布流程处理；不要把某一种部署方式硬套到所有项目上。',
    '如果用户给了明确的本地路径，并且任务是部署，请尽快围绕这个路径行动。',
    '',
    '本地环境',
    `当前工作目录: ${session.localContext.cwd}`,
    `用户主目录: ${session.localContext.homeDir}`,
    `桌面目录: ${session.localContext.desktopDir}`,
    `平台: ${session.localContext.platform}`,
    '',
    '远程环境',
    remote,
    '',
    '已识别项目路径',
    knownProjects,
    '',
    '当前任务',
    session.planState.global_goal,
    '',
    '已知事实',
    session.planState.scratchpad || '暂无',
    '',
    '输出要求',
    '1. 工具调用前可以用一句中文简短说明正在做什么。',
    '2. 真正完成后再给最终结论，包含部署地址、关键修复点和剩余风险。',
    '3. 不要输出伪造的成功结果。',
  ].join('\n');
}

export function appendScratchpad(existing: string, note?: string, maxChars = 2800): string {
  if (!note?.trim()) return existing;
  const next = existing ? `${existing}\n- ${note.trim()}` : `- ${note.trim()}`;
  if (next.length <= maxChars) return next;
  return `[earlier notes truncated]\n${next.slice(-maxChars)}`;
}

export function makeArtifactPreview(content: string, maxChars = 1000): string {
  const normalized = content.replace(/\r/g, '');
  if (normalized.length <= maxChars) return normalized;
  const head = normalized.slice(0, Math.floor(maxChars * 0.7));
  const tail = normalized.slice(-Math.floor(maxChars * 0.2));
  return `${head}\n...[artifact truncated]...\n${tail}`;
}

export function summarizeArtifact(artifact: AgentArtifact): string {
  return `Artifact ${artifact.id} (${artifact.title}):\n${clip(artifact.preview, 500)}`;
}
