import { open, readdir, realpath, stat } from 'fs/promises';
import { homedir } from 'os';
import * as path from 'path';
import type { AgentFiles } from './files';
import type { AgentShell } from './shell';
import { runLocalShell } from './localShell';
import type { ToolDefinition } from './providers/types';
import type { AgentMode } from '../../src/shared/agent';

export interface ToolContext {
  shell: AgentShell;
  files: AgentFiles;
  /** Controls whether commands may run on the local machine. */
  mode: AgentMode;
  /** The one local folder the agent may read. Null until the user grants one. */
  localRoot: string | null;
  /** Streams plain output and, when available, its ANSI-preserving terminal copy. */
  report(chunk: string, terminalChunk?: string): void;
  signal: AbortSignal;
}

export interface AgentTool {
  definition: ToolDefinition;
  /** Returns what the model should see. Throwing turns into an error result. */
  run(input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

const MAX_UPLOAD_FILES = 5000;
const MAX_LOCAL_READ_BYTES = 512 * 1024;
const LOCAL_BINARY_SNIFF_BYTES = 4096;

/**
 * Descriptions say *when* to reach for a tool, not only what it does.
 * A trigger condition in the description measurably raises how often a model calls the
 * right tool, which matters most for the ones it otherwise under-uses.
 */
export const TOOLS: AgentTool[] = [
  {
    definition: {
      name: 'shell',
      description:
        'Run a shell command on the remote server. This is the main way to do anything: '
        + 'inspect the system, install packages, build, start services, check logs. The '
        + 'shell is persistent for the whole task, so a `cd` carries over to later calls '
        + 'and so do exported variables. A non-zero exit code is returned to you normally '
        + 'and is not an error — read stderr and decide what to do. Always use '
        + 'non-interactive flags (-y, --yes, DEBIAN_FRONTEND=noninteractive); a command '
        + 'that waits for input will hit the timeout and be killed.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run.' },
          cwd: {
            type: 'string',
            description:
              'Run in this directory without changing the persistent one. Omit and use `cd` '
              + 'when you want the change to stick.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Defaults to 120. Raise it for builds and installs.',
          },
        },
        required: ['command'],
      },
    },
    async run(input, context) {
      const command = requireString(input, 'command');
      const timeout = typeof input.timeout_seconds === 'number' ? input.timeout_seconds : undefined;
      const result = await context.shell.run(command, {
        cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
        timeoutMs: timeout ? timeout * 1000 : undefined,
        // Routed to whichever call is running, so a long build is watchable as it goes.
        onOutput: (chunk, _stream, plainChunk) => context.report(plainChunk, chunk),
      });

      const parts: string[] = [];
      if (result.timedOut) {
        parts.push(
          '[timed out — the channel was closed, but the remote process may still be running; '
          + 'check with ps and kill it if needed]',
        );
      } else {
        parts.push(`[exit ${result.exitCode ?? 'unknown'}]`);
      }
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
      if (result.truncated) parts.push('[output was long; the middle was elided]');
      return parts.join('\n') || '[no output]';
    },
  },

  {
    definition: {
      name: 'local_shell',
      description:
        'Run a non-interactive command on the computer hosting Reflex. This tool is only '
        + 'available in free mode. Use it when local files must be created, changed, '
        + 'deleted, extracted, built or otherwise processed before deployment. On Windows '
        + 'commands run in PowerShell; on macOS and Linux they run in the system shell.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The local command to run.' },
          cwd: {
            type: 'string',
            description:
              'Any absolute local directory, or a path relative to the shared folder/home directory.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Defaults to 120 seconds; maximum 3600 seconds.',
          },
        },
        required: ['command'],
      },
    },
    async run(input, context) {
      const command = requireString(input, 'command');
      const cwd = await resolveLocal(
        context,
        typeof input.cwd === 'string' ? input.cwd : '.',
      );
      const seconds = typeof input.timeout_seconds === 'number'
        ? Math.min(3600, Math.max(1, input.timeout_seconds))
        : 120;
      const result = await runLocalShell(command, {
        cwd,
        timeoutMs: seconds * 1000,
        signal: context.signal,
        onOutput: (chunk) => context.report(chunk),
      });

      const parts: string[] = [
        result.timedOut ? `[timed out after ${seconds} seconds]` : `[exit ${result.exitCode ?? 'unknown'}]`,
      ];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
      if (result.truncated) parts.push('[output was truncated]');
      return parts.join('\n');
    },
  },

  {
    definition: {
      name: 'read_file',
      description:
        'Read a text file on the remote server. Prefer this over `cat` when you intend to '
        + 'edit the file afterwards, because edit_file matches against exactly what this '
        + 'returns. For a file too large to read whole, pass offset and limit.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path on the server.' },
          offset: { type: 'number', description: 'First line to return, 0-based.' },
          limit: { type: 'number', description: 'How many lines. Defaults to 2000.' },
        },
        required: ['path'],
      },
    },
    async run(input, context) {
      const result = await context.files.read(requireString(input, 'path'), {
        offset: numberOr(input.offset, undefined),
        limit: numberOr(input.limit, undefined),
      });
      const header = `[lines ${result.startLine}-${result.startLine + result.content.split('\n').length - 1}`
        + ` of ${result.totalLines}${result.truncated ? ', truncated' : ''}]`;
      return `${header}\n${result.content}`;
    },
  },

  {
    definition: {
      name: 'write_file',
      description:
        'Create or overwrite a text file on the remote server. Use this rather than a shell '
        + 'heredoc for anything you author — config files, unit files, compose files — '
        + 'because a heredoc mangles quotes, $ and backticks. Parent directories are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path on the server.' },
          content: { type: 'string', description: 'The complete file contents.' },
        },
        required: ['path', 'content'],
      },
    },
    async run(input, context) {
      const target = requireString(input, 'path');
      await context.files.write(target, requireString(input, 'content'));
      return `Wrote ${target}.`;
    },
  },

  {
    definition: {
      name: 'edit_file',
      description:
        'Replace one exact passage in a remote file. old_string must appear exactly once — '
        + 'include enough surrounding lines to make it unique. If it now matches zero times '
        + 'or several, the edit is refused, which is how you find out the file changed since '
        + 'you read it. Read the file first.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path on the server.' },
          old_string: { type: 'string', description: 'Exact text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    async run(input, context) {
      const target = requireString(input, 'path');
      const { replacedAt } = await context.files.edit(
        target,
        requireString(input, 'old_string'),
        requireString(input, 'new_string'),
      );
      return `Edited ${target} at line ${replacedAt}.`;
    },
  },

  {
    definition: {
      name: 'upload_project',
      description:
        'Copy a file or folder from anywhere on the user\'s machine to the server. '
        + 'Absolute local paths work in every mode. Use this to deploy a local '
        + 'project. Build output is not excluded, but .git, node_modules, virtualenvs, logs '
        + 'and anything credential-shaped are, along with whatever the project\'s .gitignore '
        + 'lists — so install dependencies on the server afterwards rather than expecting '
        + 'them to arrive. Skipped credential files are reported back; tell the user about '
        + 'them, since a missing .env usually breaks the deploy.',
      parameters: {
        type: 'object',
        properties: {
          local_path: {
            type: 'string',
            description:
              'Any absolute local path, or a path relative to the shared folder/home directory.',
          },
          remote_path: {
            type: 'string',
            description:
              'Absolute destination on the server. For a file, include its destination filename.',
          },
        },
        required: ['local_path', 'remote_path'],
      },
    },
    async run(input, context) {
      const source = await resolveLocal(context, requireString(input, 'local_path'));
      const destination = requireString(input, 'remote_path');
      const sourceInfo = await stat(source);

      if (sourceInfo.isFile()) {
        await context.files.uploadFile(source, destination, context.signal);
        return `Uploaded ${path.basename(source)} (${formatBytes(sourceInfo.size)}) to ${destination}.`;
      }
      if (!sourceInfo.isDirectory()) {
        throw new Error(`${source} is not a regular file or directory`);
      }

      const plan = await context.files.uploadDirectory(
        source,
        destination,
        (progress) => {
          // Only every so often: a per-file event on a thousand files is noise.
          if (progress.done % 25 === 0 || progress.done === progress.total) {
            context.report(`${progress.done}/${progress.total} ${progress.path}\n`);
          }
        },
        { maxFiles: MAX_UPLOAD_FILES, signal: context.signal },
      );

      const lines = [
        `Uploaded ${plan.files.length} files (${formatBytes(plan.totalBytes)}) to ${destination}.`,
      ];
      if (plan.notableSkips.length > 0) {
        lines.push(
          `Skipped as credential-shaped: ${plan.notableSkips.slice(0, 10).join(', ')}. `
          + 'Create them on the server if the app needs them.',
        );
      }
      return lines.join('\n');
    },
  },

  {
    definition: {
      name: 'list_local',
      description:
        'List a directory anywhere on the user\'s computer. Absolute paths work in every '
        + 'mode without sharing a folder first. Use this first when the task '
        + 'mentions a local project, to work out what kind of project it is before deciding '
        + 'how to deploy it.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Any absolute local path, or a path relative to the shared folder/home directory. Defaults to ".".',
          },
        },
      },
    },
    async run(input, context) {
      const directory = await resolveLocal(
        context,
        typeof input.path === 'string' ? input.path : '.',
      );
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length === 0) return '[empty]';

      const rows = await Promise.all(entries.map(async (entry) => {
        if (entry.isDirectory()) return `${entry.name}/`;
        const info = await stat(path.join(directory, entry.name)).catch(() => null);
        return `${entry.name}${info ? `  ${formatBytes(info.size)}` : ''}`;
      }));
      return rows.sort().join('\n');
    },
  },

  {
    definition: {
      name: 'read_local',
      description:
        'Read a text file anywhere on the user\'s computer. Absolute paths work in every '
        + 'mode without sharing a folder first. Use it to identify the stack '
        + 'and its build and start commands — package.json, requirements.txt, go.mod, '
        + 'Dockerfile, compose files — before planning the deployment.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Any absolute local path, or a path relative to the shared folder/home directory.',
          },
          limit: { type: 'number', description: 'How many lines. Defaults to 500.' },
        },
        required: ['path'],
      },
    },
    async run(input, context) {
      const file = await resolveLocal(context, requireString(input, 'path'));
      const info = await stat(file);
      if (info.isDirectory()) throw new Error(`${file} is a directory; use list_local instead`);
      if (!info.isFile()) throw new Error(`${file} is not a regular file`);

      const bytesToRead = Math.min(info.size, MAX_LOCAL_READ_BYTES);
      const buffer = Buffer.alloc(bytesToRead);
      const handle = await open(file, 'r');
      const { bytesRead } = await handle
        .read(buffer, 0, bytesToRead, 0)
        .finally(() => handle.close());
      const content = buffer.subarray(0, bytesRead);
      if (content.subarray(0, LOCAL_BINARY_SNIFF_BYTES).includes(0)) {
        throw new Error(`${file} is a binary file; use upload_project to send it to the server`);
      }

      const text = content.toString('utf-8');
      const limit = numberOr(input.limit, 500) ?? 500;
      const lines = text.split('\n');
      const window = lines.slice(0, limit).join('\n');
      if (info.size > bytesRead) return `${window}\n[file truncated after ${formatBytes(bytesRead)}]`;
      return lines.length > limit ? `${window}\n[… ${lines.length - limit} more lines]` : window;
    },
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((tool) => tool.definition);

/** Hides local command execution from the model unless the user selected free mode. */
export function toolDefinitionsForMode(mode: AgentMode): ToolDefinition[] {
  return mode === 'free'
    ? TOOL_DEFINITIONS
    : TOOL_DEFINITIONS.filter((definition) => definition.name !== 'local_shell');
}

const BY_NAME = new Map(TOOLS.map((tool) => [tool.definition.name, tool]));
export function findTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/**
 * Resolves a path on the user's machine.
 *
 * Absolute paths are accepted in every mode. A shared folder is only a convenient base
 * for relative paths; without one, relative paths start at the user's home directory.
 * Local mutation remains unavailable outside free mode because only local_shell can do it.
 */
export async function resolveLocal(context: ToolContext, requested: string): Promise<string> {
  const base = context.localRoot
    ? await realpath(context.localRoot).catch(() => context.localRoot as string)
    : homedir();
  const target = path.isAbsolute(requested)
    ? path.normalize(requested)
    : path.resolve(base, requested);
  return realpath(target).catch(() => target);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
