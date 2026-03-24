import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveIgnorePatterns } from './ignoreResolver.js';

function runTar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });
}

export async function createArchive(params: {
  rootPath: string;
  outFile: string;
  extraIgnorePatterns?: string[];
}): Promise<void> {
  await fs.mkdir(path.dirname(params.outFile), { recursive: true });
  const ignorePatterns = await resolveIgnorePatterns(params.rootPath, params.extraIgnorePatterns);
  const tarArgs = [
    '-czf',
    params.outFile,
    ...ignorePatterns.flatMap((pattern) => [`--exclude=${pattern}`]),
    '.',
  ];
  await runTar(tarArgs, params.rootPath);
}
