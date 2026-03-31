import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { shQuote } from '../deploy/strategies/base.js';
import { SSHManager } from '../ssh/sshManager.js';
import { AgentThreadSession, AgentToolCallArgs, AgentToolDefinition } from './types.js';

const execFile = promisify(execFileCallback);

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function normalizeLocalPath(targetPath: string): string {
  if (path.isAbsolute(targetPath)) return path.normalize(targetPath);
  return path.resolve(targetPath);
}

function truncate(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function requireString(args: AgentToolCallArgs, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required string field: ${field}`);
  }
  return value.trim();
}

async function runLocalCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runLocalCommandWithTimeout(command, 300000);
}

async function runLocalCommandWithTimeout(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const shellArgs = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command];

  try {
    const { stdout, stderr } = await execFile(shell, shellArgs, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error?.stdout ? String(error.stdout) : '',
      stderr: error?.stderr ? String(error.stderr) : (error?.message || String(error)),
      exitCode: typeof error?.code === 'number' ? error.code : 1,
    };
  }
}

async function probeRemoteContext(sshMgr: SSHManager, connectionId: string, host: string) {
  const script = [
    'USER_NAME=$(whoami 2>/dev/null || echo unknown)',
    'PWD_NOW=$(pwd 2>/dev/null || echo ~)',
    'OS_NAME=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\' || uname -a)',
    'NODE_VERSION=$(node -v 2>/dev/null || echo missing)',
    'DOCKER_STATUS=$(docker --version 2>/dev/null || echo missing)',
    'printf "USER:%s\\nPWD:%s\\nOS:%s\\nNODE:%s\\nDOCKER:%s\\n" "$USER_NAME" "$PWD_NOW" "$OS_NAME" "$NODE_VERSION" "$DOCKER_STATUS"',
  ].join('\n');
  const result = await sshMgr.exec(connectionId, `sh -lc ${shQuote(script)}`, 20000);
  const lines = result.stdout.split('\n');
  const read = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() || 'unknown';
  return {
    host,
    user: read('USER:'),
    pwd: read('PWD:'),
    os: read('OS:'),
    node: read('NODE:'),
    docker: read('DOCKER:'),
  };
}

function describeList(entries: Array<{ name: string; type?: string; size?: number }>): string {
  if (!entries.length) return '(empty directory)';
  return entries
    .slice(0, 80)
    .map((entry) => `${entry.type === 'd' ? '[dir]' : '[file]'} ${entry.name}${typeof entry.size === 'number' ? ` (${entry.size} bytes)` : ''}`)
    .join('\n');
}

export function createAgentToolRegistry(
  sshMgr: SSHManager,
): AgentToolDefinition {
  const definitions = [
    {
      type: 'function' as const,
      function: {
        name: 'local_list_directory',
        description: 'List a local directory on the user machine. Use this to inspect desktop projects before deployment.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative local directory path.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'local_read_file',
        description: 'Read a local text file from the user machine.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative local file path.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'local_write_file',
        description: 'Create or overwrite a local text file on the user machine.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative local file path.' },
            content: { type: 'string', description: 'Text content to write.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'local_exec',
        description: 'Execute a command on the local machine. Prefer for project inspection or build checks.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute locally.' },
            timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 300000.' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_exec',
        description: 'Execute a shell command on the connected remote server over SSH.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute remotely.' },
            timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 600000.' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_list_directory',
        description: 'List a directory on the remote server over SFTP.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute remote directory path.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_read_file',
        description: 'Read a text file from the remote server over SFTP.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute remote file path.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_write_file',
        description: 'Write a text file to the remote server over SFTP.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute remote file path.' },
            content: { type: 'string', description: 'Text content to write.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_upload_file',
        description: 'Upload a local file to the remote server over built-in SFTP. Use this for dist archives, build artifacts, binaries, images, or any non-text transfer. Do not fall back to scp, base64 chunking, python receivers, nc, or temporary upload servers when this tool can handle the transfer.',
        parameters: {
          type: 'object',
          properties: {
            localPath: { type: 'string', description: 'Absolute local file path.' },
            remotePath: { type: 'string', description: 'Absolute remote destination file path.' },
            createParentDirs: { type: 'boolean', description: 'Create remote parent directories first. Defaults to true.' },
          },
          required: ['localPath', 'remotePath'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remote_download_file',
        description: 'Download a remote file to the local machine using built-in SFTP.',
        parameters: {
          type: 'object',
          properties: {
            remotePath: { type: 'string', description: 'Absolute remote file path.' },
            localPath: { type: 'string', description: 'Absolute local destination file path.' },
          },
          required: ['remotePath', 'localPath'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'http_probe',
        description: 'Probe an HTTP URL from the connected server and return the observed status code.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTP or HTTPS URL to probe.' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'service_inspect',
        description: 'Inspect a systemd service on the remote server and return current status plus recent logs.',
        parameters: {
          type: 'object',
          properties: {
            serviceName: { type: 'string', description: 'Systemd service name, for example nginx or myapp.service.' },
          },
          required: ['serviceName'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'service_control',
        description: 'Control a systemd service on the remote server.',
        parameters: {
          type: 'object',
          properties: {
            serviceName: { type: 'string', description: 'Systemd service name.' },
            action: { type: 'string', enum: ['start', 'stop', 'restart', 'reload', 'enable', 'disable'], description: 'Action to perform.' },
          },
          required: ['serviceName', 'action'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'git_clone_remote',
        description: 'Clone a Git repository directly on the remote server.',
        parameters: {
          type: 'object',
          properties: {
            repoUrl: { type: 'string', description: 'Clone URL.' },
            targetDir: { type: 'string', description: 'Absolute remote destination directory.' },
            ref: { type: 'string', description: 'Optional branch, tag, or commit-ish.' },
          },
          required: ['repoUrl', 'targetDir'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'git_fetch_remote',
        description: 'Fetch updates for an existing remote Git checkout and optionally switch to a ref.',
        parameters: {
          type: 'object',
          properties: {
            targetDir: { type: 'string', description: 'Absolute remote repository directory.' },
            ref: { type: 'string', description: 'Optional branch, tag, or commit-ish.' },
          },
          required: ['targetDir'],
        },
      },
    },
  ];

  return {
    definitions,
    async execute(name, args, session) {
      switch (name) {
        case 'local_list_directory': {
          const targetPath = normalizeLocalPath(requireString(args, 'path'));
          const entries = await fs.readdir(targetPath, { withFileTypes: true });
          const serialized = await Promise.all(entries.slice(0, 200).map(async (entry) => {
            const absolutePath = path.join(targetPath, entry.name);
            const stat = await fs.stat(absolutePath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'd' : '-',
              size: stat.size,
            };
          }));
          return {
            ok: true,
            displayCommand: `local ls ${targetPath}`,
            content: describeList(serialized),
            structured: { path: targetPath, entries: serialized },
            scratchpadNote: `发现本地目录 ${targetPath}`,
          };
        }
        case 'local_read_file': {
          const targetPath = normalizeLocalPath(requireString(args, 'path'));
          const content = await fs.readFile(targetPath, 'utf8');
          return {
            ok: true,
            displayCommand: `local cat ${targetPath}`,
            content: truncate(content),
            structured: { path: targetPath, content },
            scratchpadNote: `读取本地文件 ${targetPath}`,
          };
        }
        case 'local_write_file': {
          const targetPath = normalizeLocalPath(requireString(args, 'path'));
          const content = stringify(args.content ?? '');
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return {
            ok: true,
            displayCommand: `local write ${targetPath}`,
            content: `Wrote ${targetPath}`,
            structured: { path: targetPath },
            scratchpadNote: `写入本地文件 ${targetPath}`,
          };
        }
        case 'local_exec': {
          const command = requireString(args, 'command');
          const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
            ? Math.max(1000, Math.min(args.timeoutMs, 20 * 60 * 1000))
            : 300000;
          const result = await runLocalCommandWithTimeout(command, timeoutMs);
          return {
            ok: result.exitCode === 0,
            displayCommand: command,
            content: truncate([result.stdout, result.stderr ? `[stderr]\n${result.stderr}` : ''].filter(Boolean).join('\n') || '(no output)'),
            structured: result,
            scratchpadNote: result.exitCode === 0 ? `本地命令成功: ${command}` : `本地命令失败: ${command}`,
          };
        }
        case 'remote_exec': {
          const command = requireString(args, 'command');
          const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
            ? Math.max(1000, Math.min(args.timeoutMs, 20 * 60 * 1000))
            : 600000;
          const wrapped = `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb sh -lc ${shQuote(command)}`;
          session.webContents.send('terminal-data', {
            id: session.connectionId,
            data: `\r\n\x1b[36;2m[Agent] $ ${command}\x1b[0m\r\n`,
          });
          const result = await sshMgr.exec(session.connectionId, wrapped, timeoutMs);
          if (result.stdout) {
            session.webContents.send('terminal-data', {
              id: session.connectionId,
              data: result.stdout.replace(/\n/g, '\r\n'),
            });
          }
          if (result.stderr) {
            session.webContents.send('terminal-data', {
              id: session.connectionId,
              data: `\x1b[33m${result.stderr.replace(/\n/g, '\r\n')}\x1b[0m`,
            });
          }
          session.webContents.send('terminal-data', {
            id: session.connectionId,
            data: `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`,
          });
          return {
            ok: result.exitCode === 0,
            displayCommand: command,
            content: truncate([result.stdout, result.stderr ? `[stderr]\n${result.stderr}` : ''].filter(Boolean).join('\n') || '(no output)'),
            structured: result,
            scratchpadNote: result.exitCode === 0 ? `远程命令成功: ${command}` : `远程命令失败: ${command}`,
          };
        }
        case 'remote_list_directory': {
          const targetPath = requireString(args, 'path');
          const entries = await sshMgr.listFiles(session.connectionId, targetPath);
          return {
            ok: true,
            displayCommand: `remote ls ${targetPath}`,
            content: describeList(entries),
            structured: { path: targetPath, entries },
            scratchpadNote: `查看远程目录 ${targetPath}`,
          };
        }
        case 'remote_read_file': {
          const targetPath = requireString(args, 'path');
          let content: string;
          try {
            content = await sshMgr.readFile(session.connectionId, targetPath);
          } catch {
            const fallback = await sshMgr.exec(
              session.connectionId,
              `sh -lc ${shQuote(`if [ -f ${shQuote(targetPath)} ]; then cat ${shQuote(targetPath)}; fi`)}`,
              30000,
            );
            content = fallback.stdout || '';
          }
          return {
            ok: true,
            displayCommand: `remote cat ${targetPath}`,
            content: truncate(content),
            structured: { path: targetPath, content },
            scratchpadNote: `读取远程文件 ${targetPath}`,
          };
        }
        case 'remote_write_file': {
          const targetPath = requireString(args, 'path');
          const content = stringify(args.content ?? '');
          await sshMgr.writeFile(session.connectionId, targetPath, content);
          return {
            ok: true,
            displayCommand: `remote write ${targetPath}`,
            content: `Wrote ${targetPath}`,
            structured: { path: targetPath },
            scratchpadNote: `写入远程文件 ${targetPath}`,
          };
        }
        case 'remote_upload_file': {
          const localPath = normalizeLocalPath(requireString(args, 'localPath'));
          const remotePath = requireString(args, 'remotePath');
          const createParentDirs = args.createParentDirs !== false;
          const stat = await fs.stat(localPath).catch(() => null);
          if (!stat?.isFile()) {
            throw new Error(`Local file does not exist: ${localPath}`);
          }
          if (createParentDirs) {
            const parentDir = path.posix.dirname(remotePath.replace(/\\/g, '/'));
            await sshMgr.exec(session.connectionId, `sh -lc ${shQuote(`mkdir -p ${shQuote(parentDir)}`)}`, 30000);
          }
          await sshMgr.uploadFile(session.connectionId, localPath, remotePath);
          return {
            ok: true,
            displayCommand: `upload ${localPath} -> ${remotePath}`,
            content: `Uploaded ${path.basename(localPath)} to ${remotePath}`,
            structured: {
              localPath,
              remotePath,
              size: stat.size,
            },
            scratchpadNote: `Uploaded file ${localPath} -> ${remotePath}`,
          };
        }
        case 'remote_download_file': {
          const remotePath = requireString(args, 'remotePath');
          const localPath = normalizeLocalPath(requireString(args, 'localPath'));
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await sshMgr.downloadFile(session.connectionId, remotePath, localPath);
          return {
            ok: true,
            displayCommand: `download ${remotePath} -> ${localPath}`,
            content: `Downloaded ${remotePath} to ${localPath}`,
            structured: { remotePath, localPath },
            scratchpadNote: `Downloaded file ${remotePath} -> ${localPath}`,
          };
        }
        case 'http_probe': {
          const url = requireString(args, 'url');
          const result = await sshMgr.exec(
            session.connectionId,
            `sh -lc ${shQuote(`STATUS=$(curl -k -L -s -o /dev/null -w "%{http_code}" ${JSON.stringify(url)}); printf "%s" "$STATUS"`)}`,
            20000,
          );
          const status = Number(result.stdout.trim().split(/\s+/).pop() || 0);
          return {
            ok: status > 0 && status < 600,
            displayCommand: `http probe ${url}`,
            content: `HTTP ${status || 'no-response'} from ${url}`,
            structured: { url, status },
            scratchpadNote: `HTTP probe ${url} -> ${status || 'no-response'}`,
          };
        }
        case 'service_inspect': {
          const serviceName = requireString(args, 'serviceName');
          const command = [
            `systemctl status ${JSON.stringify(serviceName)} --no-pager || true`,
            `echo`,
            `journalctl -u ${JSON.stringify(serviceName)} -n 80 --no-pager || true`,
          ].join('; ');
          const result = await sshMgr.exec(session.connectionId, `sh -lc ${shQuote(command)}`, 30000);
          return {
            ok: result.exitCode === 0,
            displayCommand: `inspect service ${serviceName}`,
            content: truncate([result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'),
            structured: { serviceName, ...result },
            scratchpadNote: `Inspected service ${serviceName}`,
          };
        }
        case 'service_control': {
          const serviceName = requireString(args, 'serviceName');
          const action = requireString(args, 'action');
          const result = await sshMgr.exec(
            session.connectionId,
            `PAGER=cat SYSTEMD_PAGER=cat sh -lc ${shQuote(`sudo systemctl ${action} ${JSON.stringify(serviceName)}`)}`,
            30000,
          );
          return {
            ok: result.exitCode === 0,
            displayCommand: `systemctl ${action} ${serviceName}`,
            content: truncate([result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'),
            structured: { serviceName, action, ...result },
            scratchpadNote: result.exitCode === 0 ? `Service ${serviceName} ${action} succeeded` : `Service ${serviceName} ${action} failed`,
          };
        }
        case 'git_clone_remote': {
          const repoUrl = requireString(args, 'repoUrl');
          const targetDir = requireString(args, 'targetDir');
          const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
          const cloneCommand = ref
            ? `rm -rf ${shQuote(targetDir)} && git clone --depth 1 --branch ${shQuote(ref)} ${shQuote(repoUrl)} ${shQuote(targetDir)}`
            : `rm -rf ${shQuote(targetDir)} && git clone --depth 1 ${shQuote(repoUrl)} ${shQuote(targetDir)}`;
          const result = await sshMgr.exec(
            session.connectionId,
            `sh -lc ${shQuote(`mkdir -p ${shQuote(path.posix.dirname(targetDir))} && ${cloneCommand}`)}`,
            240000,
          );
          return {
            ok: result.exitCode === 0,
            displayCommand: `git clone ${repoUrl} ${targetDir}`,
            content: truncate([result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'),
            structured: { repoUrl, targetDir, ref, ...result },
            scratchpadNote: result.exitCode === 0 ? `Remote git clone ready: ${repoUrl}` : `Remote git clone failed: ${repoUrl}`,
          };
        }
        case 'git_fetch_remote': {
          const targetDir = requireString(args, 'targetDir');
          const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
          const command = [
            `git -C ${shQuote(targetDir)} fetch --depth 1 origin`,
            ref ? `git -C ${shQuote(targetDir)} checkout ${shQuote(ref)}` : '',
            ref ? `git -C ${shQuote(targetDir)} reset --hard ${shQuote(`origin/${ref}`)}` : '',
          ].filter(Boolean).join(' && ');
          const result = await sshMgr.exec(session.connectionId, `sh -lc ${shQuote(command)}`, 120000);
          return {
            ok: result.exitCode === 0,
            displayCommand: `git fetch ${targetDir}${ref ? ` @ ${ref}` : ''}`,
            content: truncate([result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'),
            structured: { targetDir, ref, ...result },
            scratchpadNote: result.exitCode === 0 ? `Remote git fetch ready: ${targetDir}` : `Remote git fetch failed: ${targetDir}`,
          };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  };
}

export async function buildLocalContext() {
  const homeDir = os.homedir();
  return {
    cwd: process.cwd(),
    homeDir,
    desktopDir: path.join(homeDir, 'Desktop'),
    platform: process.platform,
  };
}

export { probeRemoteContext };
