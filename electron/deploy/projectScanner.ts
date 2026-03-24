import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PackageManager, ProjectFramework, ProjectSpec } from '../../src/shared/deployTypes.js';

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const raw = await readTextIfExists(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function detectPackageManager(rootFiles: string[]): PackageManager | undefined {
  if (rootFiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (rootFiles.includes('yarn.lock')) return 'yarn';
  if (rootFiles.includes('bun.lockb') || rootFiles.includes('bun.lock')) return 'bun';
  if (rootFiles.includes('poetry.lock')) return 'poetry';
  if (rootFiles.includes('requirements.txt')) return 'pip';
  if (rootFiles.includes('package-lock.json') || rootFiles.includes('package.json')) return 'npm';
  return undefined;
}

function uniqNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => value > 0 && value <= 65535))).sort((a, b) => a - b);
}

function findPorts(text: string): number[] {
  const matches = text.match(/\b([1-9]\d{1,4})\b/g) || [];
  return uniqNumbers(
    matches
      .map((value) => Number(value))
      .filter((value) => value >= 80 && value <= 65535),
  );
}

function detectFramework(input: {
  files: string[];
  packageJson: ProjectSpec['packageJson'];
  dockerfile: string | null;
  dockerCompose: string | null;
  requirements: string | null;
  pyproject: string | null;
}): { framework: ProjectFramework; evidence: string[] } {
  const dependencies = {
    ...(input.packageJson?.dependencies || {}),
    ...(input.packageJson?.devDependencies || {}),
  };
  const scripts = input.packageJson?.scripts || {};
  const evidence: string[] = [];

  if (input.dockerCompose) {
    evidence.push('docker-compose.yml found');
    return { framework: 'docker-compose', evidence };
  }

  if (input.dockerfile) {
    evidence.push('Dockerfile found');
    return { framework: 'dockerfile', evidence };
  }

  if (dependencies.next) {
    evidence.push('next dependency found');
    return { framework: 'nextjs', evidence };
  }

  if (dependencies.vite || input.files.some((file) => /^vite\.config\./.test(file))) {
    evidence.push('Vite config or dependency found');
    return { framework: 'vite-static', evidence };
  }

  if (dependencies['react-scripts']) {
    evidence.push('react-scripts dependency found');
    return { framework: 'react-spa', evidence };
  }

  if (
    dependencies.express ||
    dependencies.koa ||
    dependencies.fastify ||
    dependencies.nest ||
    scripts.start ||
    scripts.dev
  ) {
    evidence.push('Node server dependency or start script found');
    return { framework: 'node-service', evidence };
  }

  const pythonContent = `${input.requirements || ''}\n${input.pyproject || ''}`.toLowerCase();
  if (pythonContent.includes('fastapi')) {
    evidence.push('fastapi dependency found');
    return { framework: 'python-fastapi', evidence };
  }
  if (pythonContent.includes('flask')) {
    evidence.push('flask dependency found');
    return { framework: 'python-flask', evidence };
  }
  if (input.requirements || input.pyproject) {
    evidence.push('Python dependency file found');
    return { framework: 'python-service', evidence };
  }

  return { framework: 'unknown', evidence };
}

function detectOutputDir(framework: ProjectFramework, scripts: Record<string, string> | undefined, files: string[]): string | undefined {
  if (framework === 'nextjs') return '.next';
  if (files.includes('dist')) return 'dist';
  if (files.includes('build')) return 'build';
  if (framework === 'vite-static' || framework === 'react-spa') return 'dist';
  if (scripts?.build?.includes('--output')) {
    const match = scripts.build.match(/--output(?:-path)?\s+([^\s]+)/);
    if (match) return match[1];
  }
  return undefined;
}

async function listRootFiles(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries.map((entry) => entry.name);
}

export class ProjectScanner {
  async scan(rootPath: string): Promise<ProjectSpec> {
    const rootFiles = await listRootFiles(rootPath);
    const packageJson = await readJsonIfExists<ProjectSpec['packageJson']>(path.join(rootPath, 'package.json'));
    const dockerfile = await readTextIfExists(path.join(rootPath, 'Dockerfile'));
    const dockerCompose =
      (await readTextIfExists(path.join(rootPath, 'docker-compose.yml'))) ||
      (await readTextIfExists(path.join(rootPath, 'compose.yml')));
    const requirements = await readTextIfExists(path.join(rootPath, 'requirements.txt'));
    const pyproject = await readTextIfExists(path.join(rootPath, 'pyproject.toml'));

    const { framework, evidence } = detectFramework({
      files: rootFiles,
      packageJson: packageJson || undefined,
      dockerfile,
      dockerCompose,
      requirements,
      pyproject,
    });

    const envFiles = rootFiles.filter((name) => name.startsWith('.env'));
    const packageManager = detectPackageManager(rootFiles);
    const scripts = packageJson?.scripts || {};
    const outputDir = detectOutputDir(framework, scripts, rootFiles);

    const portSources = [
      packageJson ? JSON.stringify(packageJson) : '',
      dockerfile || '',
      dockerCompose || '',
      requirements || '',
      pyproject || '',
      ...(await Promise.all(envFiles.map((file) => readTextIfExists(path.join(rootPath, file))))).filter(
        (value): value is string => Boolean(value),
      ),
    ].join('\n');

    const projectName =
      packageJson?.name ||
      path.basename(rootPath).replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() ||
      'app';

    return {
      id: crypto.createHash('sha1').update(rootPath).digest('hex'),
      rootPath,
      name: projectName,
      fingerprints: rootFiles,
      framework,
      packageManager,
      buildCommand: scripts.build,
      startCommand: scripts.start,
      outputDir,
      envFiles,
      ports: findPorts(portSources),
      evidence,
      packageJson: packageJson || undefined,
      files: rootFiles,
    };
  }
}
