import { Dirent, promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PackageManager, ProjectFramework, ProjectSpec } from '../../src/shared/deployTypes.js';

type EnvMap = Record<string, string>;

const WINDOWS_PATH_RE = /[A-Za-z]:\\[^\r\n"'`<>|]+/g;
const POSIX_PATH_RE = /\/(?:Users|home|opt|srv|var|tmp)[^\r\n"'`<>|]*/g;
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|py)$/i;
const SOURCE_SCAN_DIRS = ['src', 'app', 'server', 'config', 'lib', 'routes'];
const PERSISTENT_DIR_HINTS = [
  'uploads',
  'upload',
  'storage',
  'data',
  'tmp',
  'logs',
  'public/uploads',
  'public/storage',
];
const ENV_FILE_PRIORITY = [
  '.env.example',
  '.env.sample',
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
];
const DEFAULT_HEALTH_PATHS = ['/health', '/api/health', '/healthz', '/api/ping', '/ping'];

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

async function pathExists(targetPath: string, directoryOnly = false) {
  try {
    const stat = await fs.stat(targetPath);
    return directoryOnly ? stat.isDirectory() : true;
  } catch {
    return false;
  }
}

function normalizeInputPath(input: string) {
  return input.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
}

function stripProjectPathNoise(input: string) {
  let current = normalizeInputPath(input);
  let changed = true;
  while (changed) {
    const next = current
      .replace(/[，。！？；：,.;!?]+$/u, '')
      .replace(
        /(这个项目|此项目|项目目录|项目文件夹|文件夹|目录|部署到服务器上|部署到服务器|部署上去|部署一下|部署|发布到服务器|发布|上线|上传到服务器|上传|please|pls)$/iu,
        '',
      )
      .trim();
    changed = next !== current;
    current = next;
  }
  return current;
}

async function resolveCandidateDirectory(candidate: string): Promise<string | null> {
  const normalized = stripProjectPathNoise(candidate);
  const attempts = new Set<string>([normalized]);

  if (!path.isAbsolute(normalized)) {
    attempts.add(path.resolve(normalized));
  }

  for (const attempt of attempts) {
    if (await pathExists(attempt, true)) return attempt;
  }

  if (!/[\\/]/.test(normalized)) return null;

  let trimmed = normalized;
  while (trimmed.length > 3) {
    trimmed = stripProjectPathNoise(trimmed.slice(0, -1));
    if (!trimmed) break;

    const trimmedAttempts = new Set<string>([trimmed]);
    if (!path.isAbsolute(trimmed)) {
      trimmedAttempts.add(path.resolve(trimmed));
    }

    for (const attempt of trimmedAttempts) {
      if (await pathExists(attempt, true)) return attempt;
    }
  }

  return null;
}

function extractPathCandidates(input: string) {
  const candidates = new Set<string>();
  const normalized = normalizeInputPath(input);
  if (normalized) candidates.add(normalized);

  for (const match of normalized.match(WINDOWS_PATH_RE) || []) {
    candidates.add(match.trim());
  }
  for (const match of normalized.match(POSIX_PATH_RE) || []) {
    candidates.add(match.trim());
  }

  return Array.from(candidates);
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
  return Array.from(new Set(values.filter((value) => value > 0 && value <= 65535))).sort(
    (a, b) => a - b,
  );
}

function findPorts(text: string): number[] {
  const matches = text.match(/\b([1-9]\d{1,4})\b/g) || [];
  return uniqNumbers(
    matches
      .map((value) => Number(value))
      .filter((value) => value >= 80 && value <= 65535),
  );
}

function parseEnvText(text: string): EnvMap {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'))
    .reduce<EnvMap>((acc, line) => {
      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const idx = normalized.indexOf('=');
      if (idx === -1) return acc;
      const key = normalized.slice(0, idx).trim();
      const value = normalized.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function sortEnvFiles(envFiles: string[]) {
  return [...envFiles].sort((a, b) => {
    const aIndex = ENV_FILE_PRIORITY.indexOf(a);
    const bIndex = ENV_FILE_PRIORITY.indexOf(b);
    const normalizedA = aIndex === -1 ? ENV_FILE_PRIORITY.length : aIndex;
    const normalizedB = bIndex === -1 ? ENV_FILE_PRIORITY.length : bIndex;
    if (normalizedA !== normalizedB) return normalizedA - normalizedB;
    return a.localeCompare(b);
  });
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
    dependencies.hono ||
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

function detectOutputDir(
  framework: ProjectFramework,
  scripts: Record<string, string> | undefined,
  files: string[],
): string | undefined {
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

async function collectEnvSources(rootPath: string, envFiles: string[]) {
  const sortedFiles = sortEnvFiles(envFiles);
  const envContents = await Promise.all(
    sortedFiles.map(async (file) => ({
      file,
      content: (await readTextIfExists(path.join(rootPath, file))) || '',
    })),
  );

  const requiredEnvVars = new Set<string>();
  const suggestedEnvVars: EnvMap = {};
  for (const item of envContents) {
    const parsed = parseEnvText(item.content);
    for (const [key, value] of Object.entries(parsed)) {
      requiredEnvVars.add(key);
      if (!(key in suggestedEnvVars) || value) {
        suggestedEnvVars[key] = value;
      }
    }
  }

  return {
    envContents,
    requiredEnvVars: Array.from(requiredEnvVars).sort(),
    suggestedEnvVars,
  };
}

async function collectSourceEnvUsages(rootPath: string, rootFiles: string[]) {
  const collected = new Set<string>();
  let scannedFiles = 0;

  const walk = async (dirPath: string, depth: number) => {
    if (depth > 3 || scannedFiles >= 120) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedFiles >= 120) return;
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!SOURCE_FILE_RE.test(entry.name)) continue;

      scannedFiles += 1;
      const text = await readTextIfExists(fullPath);
      if (!text) continue;

      for (const match of text.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g)) {
        collected.add(match[1]);
      }
      for (const match of text.matchAll(/\b(?:getenv|os\.getenv)\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)) {
        collected.add(match[1]);
      }
      for (const match of text.matchAll(/\bENV\[['"]([A-Z0-9_]+)['"]\]/g)) {
        collected.add(match[1]);
      }
    }
  };

  for (const dirName of SOURCE_SCAN_DIRS) {
    if (!rootFiles.includes(dirName)) continue;
    await walk(path.join(rootPath, dirName), 0);
  }

  return Array.from(collected).sort();
}

async function collectRouteCandidates(rootPath: string, rootFiles: string[]) {
  const collected = new Set<string>(DEFAULT_HEALTH_PATHS);
  let scannedFiles = 0;

  const walk = async (dirPath: string, depth: number) => {
    if (depth > 4 || scannedFiles >= 160) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedFiles >= 160) return;
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!SOURCE_FILE_RE.test(entry.name)) continue;

      scannedFiles += 1;
      const text = await readTextIfExists(fullPath);
      if (!text) continue;

      for (const match of text.matchAll(
        /\b(?:app|router|server|fastify)\.(?:get|post|put|patch|delete|use|all)\(\s*['"`]([^'"`]+)['"`]/g,
      )) {
        const normalized = normalizeRoutePath(match[1]);
        if (normalized) {
          collected.add(normalized);
        }
      }
    }
  };

  for (const dirName of SOURCE_SCAN_DIRS) {
    if (!rootFiles.includes(dirName)) continue;
    await walk(path.join(rootPath, dirName), 0);
  }

  return Array.from(collected)
    .sort((a, b) => scoreHealthCandidate(a) - scoreHealthCandidate(b) || a.localeCompare(b))
    .slice(0, 12);
}

function detectServiceDependencies(
  packageJson: ProjectSpec['packageJson'] | undefined,
  envVars: EnvMap,
): string[] {
  const deps = new Set(
    [
      ...Object.keys(packageJson?.dependencies || {}),
      ...Object.keys(packageJson?.devDependencies || {}),
    ].map((name) => name.toLowerCase()),
  );

  const envKeys = new Set(Object.keys(envVars).map((key) => key.toUpperCase()));
  const envValues = Object.values(envVars).join('\n').toLowerCase();
  const detected = new Set<string>();

  if (
    deps.has('pg') ||
    deps.has('postgres') ||
    envKeys.has('PGHOST') ||
    envKeys.has('POSTGRES_HOST') ||
    envValues.includes('postgres://')
  ) {
    detected.add('postgres');
  }
  if (
    deps.has('mysql') ||
    deps.has('mysql2') ||
    envKeys.has('MYSQL_HOST') ||
    envValues.includes('mysql://')
  ) {
    detected.add('mysql');
  }
  if (
    deps.has('redis') ||
    deps.has('ioredis') ||
    envKeys.has('REDIS_HOST') ||
    envValues.includes('redis://')
  ) {
    detected.add('redis');
  }
  if (
    deps.has('mongodb') ||
    deps.has('mongoose') ||
    envKeys.has('MONGO_URL') ||
    envKeys.has('MONGODB_URI') ||
    envValues.includes('mongodb://') ||
    envValues.includes('mongodb+srv://')
  ) {
    detected.add('mongodb');
  }
  if (
    !detected.has('postgres') &&
    !detected.has('mysql') &&
    !detected.has('mongodb') &&
    (envKeys.has('DB_HOST') || envKeys.has('DB_PORT') || envKeys.has('DATABASE_URL'))
  ) {
    detected.add('database');
  }

  return Array.from(detected).sort();
}

function normalizeRoutePath(routePath: string) {
  const normalized = routePath.trim();
  if (!normalized || !normalized.startsWith('/')) return null;
  if (/[:*{]/.test(normalized)) return null;
  const collapsed = normalized.replace(/\/{2,}/g, '/');
  if (collapsed !== '/' && collapsed.endsWith('/')) return collapsed.slice(0, -1);
  return collapsed;
}

function scoreHealthCandidate(routePath: string) {
  if (DEFAULT_HEALTH_PATHS.includes(routePath)) return 0;
  if (/health|ping|status/i.test(routePath)) return 1;
  if (/^\/api(?:\/|$)/.test(routePath)) return 2;
  if (/upload|static|assets/i.test(routePath)) return 4;
  return 3;
}

function detectMigrationScripts(
  packageJson: ProjectSpec['packageJson'] | undefined,
  rootFiles: string[],
): string[] {
  const scripts = Object.entries(packageJson?.scripts || {});
  const detected = scripts
    .filter(([name, command]) =>
      /migrat|prisma|sequelize|knex|db:(push|migrate|seed)|typeorm/i.test(`${name} ${command}`),
    )
    .map(([name]) => name);

  if (rootFiles.includes('prisma')) detected.push('prisma');
  if (rootFiles.includes('migrations')) detected.push('migrations');

  return Array.from(new Set(detected)).sort();
}

function detectMigrationCommands(
  packageJson: ProjectSpec['packageJson'] | undefined,
  rootFiles: string[],
): string[] {
  const scripts = packageJson?.scripts || {};
  const deps = new Set(
    [
      ...Object.keys(packageJson?.dependencies || {}),
      ...Object.keys(packageJson?.devDependencies || {}),
    ].map((name) => name.toLowerCase()),
  );
  const commands: string[] = [];
  const addCommand = (command?: string) => {
    if (command && !commands.includes(command)) {
      commands.push(command);
    }
  };

  for (const name of [
    'migrate:deploy',
    'prisma:deploy',
    'db:migrate',
    'migration:run',
    'typeorm:migration:run',
    'migrate',
    'migrations',
    'db:push',
    'prisma',
  ]) {
    if (scripts[name]) {
      addCommand(`npm run ${name}`);
    }
  }

  if (rootFiles.includes('prisma') || deps.has('prisma') || deps.has('@prisma/client')) {
    addCommand(
      rootFiles.includes('migrations')
        ? 'npx prisma migrate deploy'
        : 'npx prisma migrate deploy || npx prisma db push',
    );
  }
  if (deps.has('knex') || rootFiles.some((file) => /^knexfile\./.test(file))) {
    addCommand('npx knex migrate:latest');
  }
  if (deps.has('sequelize') || deps.has('sequelize-cli')) {
    addCommand('npx sequelize-cli db:migrate');
  }
  if (deps.has('typeorm')) {
    addCommand('npx typeorm migration:run');
  }
  if ((rootFiles.includes('alembic') || rootFiles.includes('alembic.ini')) && commands.length === 0) {
    addCommand('alembic upgrade head');
  }

  return commands;
}

async function detectPersistentPaths(rootPath: string): Promise<string[]> {
  const detected: string[] = [];
  for (const relativePath of PERSISTENT_DIR_HINTS) {
    if (await pathExists(path.join(rootPath, relativePath), true)) {
      detected.push(relativePath.replace(/\\/g, '/'));
    }
  }
  return Array.from(new Set(detected)).sort();
}

export class ProjectScanner {
  async resolveProjectRoot(rootPathInput: string): Promise<string> {
    for (const candidate of extractPathCandidates(rootPathInput)) {
      const resolved = await resolveCandidateDirectory(candidate);
      if (resolved) return resolved;
    }
    throw new Error(`Local path does not exist: ${rootPathInput}`);
  }

  async scan(rootPathInput: string): Promise<ProjectSpec> {
    const rootPath = await this.resolveProjectRoot(rootPathInput);
    const rootFiles = await listRootFiles(rootPath);
    const packageJson = await readJsonIfExists<ProjectSpec['packageJson']>(
      path.join(rootPath, 'package.json'),
    );
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
    const envSource = await collectEnvSources(rootPath, envFiles);
    const sourceEnvUsages = await collectSourceEnvUsages(rootPath, rootFiles);
    const packageManager = detectPackageManager(rootFiles);
    const scripts = packageJson?.scripts || {};
    const outputDir = detectOutputDir(framework, scripts, rootFiles);
    const suggestedEnvVars = {
      ...envSource.suggestedEnvVars,
    };
    const requiredEnvVars = Array.from(
      new Set([...envSource.requiredEnvVars, ...sourceEnvUsages]),
    ).sort();
    const serviceDependencies = detectServiceDependencies(packageJson || undefined, suggestedEnvVars);
    const migrationScripts = detectMigrationScripts(packageJson || undefined, rootFiles);
    const migrationCommands = detectMigrationCommands(packageJson || undefined, rootFiles);
    const healthCheckCandidates = await collectRouteCandidates(rootPath, rootFiles);
    const persistentPaths = await detectPersistentPaths(rootPath);

    const portSources = [
      packageJson ? JSON.stringify(packageJson) : '',
      dockerfile || '',
      dockerCompose || '',
      requirements || '',
      pyproject || '',
      ...envSource.envContents.map((item) => item.content),
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
      requiredEnvVars,
      suggestedEnvVars,
      serviceDependencies,
      migrationScripts,
      migrationCommands,
      healthCheckCandidates,
      persistentPaths,
    };
  }
}
