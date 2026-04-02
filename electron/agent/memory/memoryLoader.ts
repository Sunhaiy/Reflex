import path from 'path';
import { promises as fs } from 'fs';
import { AgentMemoryFileSummary } from '../../../src/shared/types.js';

interface LoadMemoryOptions {
  workspaceRoot: string;
  homeDir: string;
  projectPath?: string;
}

interface LoadedMemoryFiles {
  files: AgentMemoryFileSummary[];
  prompt: string;
}

function clip(text: string, maxChars = 6000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

async function readIfExists(targetPath: string) {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) return null;
    const content = await fs.readFile(targetPath, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function pushCandidate(
  seen: Set<string>,
  candidates: Array<{ scope: AgentMemoryFileSummary['scope']; path: string }>,
  scope: AgentMemoryFileSummary['scope'],
  targetPath?: string,
) {
  if (!targetPath) return;
  const normalized = path.normalize(targetPath);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push({ scope, path: normalized });
}

export class AgentMemoryLoader {
  async load(options: LoadMemoryOptions): Promise<LoadedMemoryFiles> {
    const seen = new Set<string>();
    const candidates: Array<{ scope: AgentMemoryFileSummary['scope']; path: string }> = [];
    const projectRoot = options.projectPath && path.isAbsolute(options.projectPath)
      ? options.projectPath
      : undefined;

    for (const fileName of ['CLAUDE.md', 'AGENT.md']) {
      pushCandidate(seen, candidates, 'user', path.join(options.homeDir, '.zangqing', fileName));
      pushCandidate(seen, candidates, 'workspace', path.join(options.workspaceRoot, fileName));
      pushCandidate(seen, candidates, 'workspace', path.join(options.workspaceRoot, '.zangqing', fileName));
      if (projectRoot) {
        pushCandidate(seen, candidates, 'project', path.join(projectRoot, fileName));
        pushCandidate(seen, candidates, 'project', path.join(projectRoot, '.zangqing', fileName));
      }
    }

    const loaded: Array<{ summary: AgentMemoryFileSummary; content: string }> = [];
    for (const candidate of candidates) {
      const content = await readIfExists(candidate.path);
      if (!content) continue;
      loaded.push({
        summary: {
          scope: candidate.scope,
          path: candidate.path,
          title: path.basename(candidate.path),
        },
        content: clip(content, 5000),
      });
    }

    return {
      files: loaded.map((item) => item.summary),
      prompt: loaded.length
        ? [
            'Loaded memory files (treat these as durable instructions and project memory):',
            ...loaded.map((item) => {
              return [
                `[${item.summary.scope}] ${item.summary.path}`,
                item.content,
              ].join('\n');
            }),
          ].join('\n\n')
        : '',
    };
  }
}
