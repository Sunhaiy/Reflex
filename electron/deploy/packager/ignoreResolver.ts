import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_IGNORES = [
  '.git',
  '.reflex',
  'node_modules',
  '.next/cache',
  '.turbo',
  '.idea',
  '.vscode',
  '.DS_Store',
];

async function readIgnoreFile(rootPath: string, fileName: string): Promise<string[]> {
  try {
    const fullPath = path.join(rootPath, fileName);
    const raw = await fs.readFile(fullPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export async function resolveIgnorePatterns(rootPath: string, extraPatterns: string[] = []): Promise<string[]> {
  const gitignore = await readIgnoreFile(rootPath, '.gitignore');
  const deployignore = await readIgnoreFile(rootPath, '.deployignore');

  return Array.from(
    new Set(
      [...DEFAULT_IGNORES, ...gitignore, ...deployignore, ...extraPatterns].map((item) =>
        item.replace(/\\/g, '/'),
      ),
    ),
  );
}
