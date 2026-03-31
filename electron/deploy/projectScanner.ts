import { Dirent, promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  PackageManager,
  ProjectFramework,
  ProjectLanguage,
  ProjectPackaging,
  ProjectSpec,
  RuntimeRequirement,
} from '../../src/shared/deployTypes.js';

type EnvMap = Record<string, string>;

interface ProjectScanSnapshot {
  rootPath: string;
  rootFiles: string[];
  packageJson?: string | null;
  dockerfile?: string | null;
  dockerCompose?: string | null;
  requirements?: string | null;
  pyproject?: string | null;
  pomXml?: string | null;
  gradleFile?: string | null;
  nvmrc?: string | null;
  nodeVersionFile?: string | null;
  runtimeTxt?: string | null;
  pythonVersionFile?: string | null;
  readmePath?: string;
  readmeContent?: string | null;
  envContents?: Array<{ file: string; content: string }>;
  sourceEnvUsages?: string[];
  routeCandidates?: string[];
  persistentPaths?: string[];
}

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
  if (rootFiles.includes('mvnw') || rootFiles.includes('pom.xml')) return 'maven';
  if (rootFiles.includes('gradlew') || rootFiles.includes('build.gradle') || rootFiles.includes('build.gradle.kts')) return 'gradle';
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
  pomXml: string | null;
  gradleFile: string | null;
}): { framework: ProjectFramework; evidence: string[] } {
  const dependencies = {
    ...(input.packageJson?.dependencies || {}),
    ...(input.packageJson?.devDependencies || {}),
  };
  const scripts = input.packageJson?.scripts || {};
  const evidence: string[] = [];

  if (input.dockerCompose || input.files.includes('docker-compose.yml') || input.files.includes('compose.yml')) {
    evidence.push('docker-compose.yml found');
    return { framework: 'docker-compose', evidence };
  }

  if (input.dockerfile || input.files.includes('Dockerfile')) {
    evidence.push('Dockerfile found');
    return { framework: 'dockerfile', evidence };
  }

  const javaContent = `${input.pomXml || ''}\n${input.gradleFile || ''}`.toLowerCase();
  if (
    input.pomXml ||
    input.gradleFile ||
    input.files.includes('pom.xml') ||
    input.files.includes('build.gradle') ||
    input.files.includes('build.gradle.kts')
  ) {
    if (javaContent.includes('spring-boot')) {
      evidence.push('Spring Boot build file found');
      return { framework: 'java-spring-boot', evidence };
    }
    evidence.push('Java build file found');
    return { framework: 'java-service', evidence };
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
  if (input.requirements || input.pyproject || input.files.includes('requirements.txt') || input.files.includes('pyproject.toml')) {
    evidence.push('Python dependency file found');
    return { framework: 'python-service', evidence };
  }

  return { framework: 'unknown', evidence };
}

function detectLanguage(framework: ProjectFramework): ProjectLanguage {
  if (framework === 'docker-compose' || framework === 'dockerfile') return 'docker-native';
  if (framework === 'vite-static' || framework === 'react-spa') return 'static';
  if (framework === 'nextjs' || framework === 'node-service') return 'node';
  if (framework === 'python-fastapi' || framework === 'python-flask' || framework === 'python-service') {
    return 'python';
  }
  if (framework === 'java-spring-boot' || framework === 'java-service') return 'java';
  return 'unknown';
}

function detectPackaging(framework: ProjectFramework): ProjectPackaging {
  if (framework === 'docker-compose') return 'docker-compose';
  if (framework === 'dockerfile') return 'docker-image';
  if (framework === 'vite-static' || framework === 'react-spa') return 'static-build';
  if (framework === 'java-spring-boot' || framework === 'java-service') return 'jar';
  if (framework === 'unknown') return 'unknown';
  return 'source';
}

function detectOutputDir(
  framework: ProjectFramework,
  scripts: Record<string, string> | undefined,
  files: string[],
): string | undefined {
  if (framework === 'nextjs') return '.next';
  if (framework === 'java-spring-boot' || framework === 'java-service') {
    if (files.includes('target')) return 'target';
    if (files.includes('build')) return 'build';
  }
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
  dependencyText: string,
): string[] {
  const deps = new Set(
    [
      ...Object.keys(packageJson?.dependencies || {}),
      ...Object.keys(packageJson?.devDependencies || {}),
    ].map((name) => name.toLowerCase()),
  );

  const envKeys = new Set(Object.keys(envVars).map((key) => key.toUpperCase()));
  const envValues = Object.values(envVars).join('\n').toLowerCase();
  const normalizedDependencyText = dependencyText.toLowerCase();
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
    envValues.includes('redis://') ||
    normalizedDependencyText.includes('redis')
  ) {
    detected.add('redis');
  }
  if (
    deps.has('mongodb') ||
    deps.has('mongoose') ||
    envKeys.has('MONGO_URL') ||
    envKeys.has('MONGODB_URI') ||
    envValues.includes('mongodb://') ||
    envValues.includes('mongodb+srv://') ||
    normalizedDependencyText.includes('mongodb')
  ) {
    detected.add('mongodb');
  }
  if (
    envKeys.has('KAFKA_BROKERS') ||
    envValues.includes('kafka:') ||
    normalizedDependencyText.includes('kafka')
  ) {
    detected.add('kafka');
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

function extractNodeVersion(
  packageJson: ProjectSpec['packageJson'] | undefined,
  nvmrc: string | null,
  nodeVersionFile: string | null,
) {
  return (
    packageJson?.engines?.node?.trim() ||
    nvmrc?.trim() ||
    nodeVersionFile?.trim() ||
    undefined
  );
}

function extractPythonVersion(
  pyproject: string | null,
  runtimeTxt: string | null,
  pythonVersionFile: string | null,
) {
  const pyprojectMatch = pyproject?.match(/requires-python\s*=\s*['"]([^'"]+)['"]/i)?.[1]?.trim();
  const runtimeMatch = runtimeTxt?.trim();
  const versionFile = pythonVersionFile?.trim();
  return pyprojectMatch || runtimeMatch || versionFile || undefined;
}

function extractJavaVersion(pomXml: string | null, gradleFile: string | null) {
  const pomMatch =
    pomXml?.match(/<maven\.compiler\.source>([^<]+)<\/maven\.compiler\.source>/i)?.[1]?.trim() ||
    pomXml?.match(/<java\.version>([^<]+)<\/java\.version>/i)?.[1]?.trim();
  const gradleMatch =
    gradleFile?.match(/sourceCompatibility\s*=\s*['"]?([^'"\s]+)['"]?/i)?.[1]?.trim() ||
    gradleFile?.match(/JavaVersion\.VERSION_([0-9_]+)/i)?.[1]?.replace(/_/g, '.')?.trim();
  return pomMatch || gradleMatch || undefined;
}

function detectRuntimeRequirements(input: {
  framework: ProjectFramework;
  nodeVersion?: string;
  pythonVersion?: string;
  javaVersion?: string;
  needsNginx: boolean;
}): RuntimeRequirement[] {
  const requirements: RuntimeRequirement[] = [];

  if (['node-service', 'nextjs', 'vite-static', 'react-spa'].includes(input.framework)) {
    requirements.push({ name: 'node', version: input.nodeVersion });
  }
  if (['python-fastapi', 'python-flask', 'python-service'].includes(input.framework)) {
    requirements.push({ name: 'python', version: input.pythonVersion });
  }
  if (['java-spring-boot', 'java-service'].includes(input.framework)) {
    requirements.push({ name: 'java', version: input.javaVersion });
  }
  if (input.framework === 'docker-compose') {
    requirements.push({ name: 'docker' }, { name: 'docker-compose' });
  } else if (input.framework === 'dockerfile') {
    requirements.push({ name: 'docker' });
  }
  if (input.needsNginx) {
    requirements.push({ name: 'nginx' });
  }

  return requirements;
}

function detectBuildCommands(input: {
  framework: ProjectFramework;
  scripts: Record<string, string>;
  packageManager?: PackageManager;
  rootFiles: string[];
}): string[] {
  const commands = new Set<string>();
  if (input.scripts.build) {
    commands.add(`${input.packageManager || 'npm'} run build`.replace(/^npm run build$/, 'npm run build'));
  }
  if (input.framework === 'nextjs' || input.framework === 'vite-static' || input.framework === 'react-spa') {
    commands.add('npm run build');
  }
  if (input.rootFiles.includes('mvnw')) {
    commands.add('./mvnw -DskipTests package');
  }
  if (input.rootFiles.includes('pom.xml')) {
    commands.add('mvn -DskipTests package');
  }
  if (input.rootFiles.includes('gradlew')) {
    commands.add('./gradlew build -x test');
  }
  if (input.rootFiles.includes('build.gradle') || input.rootFiles.includes('build.gradle.kts')) {
    commands.add('gradle build -x test');
  }
  if (input.rootFiles.includes('requirements.txt')) {
    commands.add('pip install -r requirements.txt');
  }
  return Array.from(commands);
}

function detectStartCommands(input: {
  framework: ProjectFramework;
  scripts: Record<string, string>;
}): string[] {
  const commands = new Set<string>();
  if (input.scripts.start) commands.add('npm run start');
  if (input.framework === 'nextjs') commands.add('npm run start');
  if (input.framework === 'node-service') commands.add('node server.js');
  if (input.framework === 'python-fastapi') commands.add('uvicorn main:app --host 0.0.0.0 --port 8000');
  if (input.framework === 'python-flask') commands.add('flask run --host 0.0.0.0 --port 8000');
  if (input.framework === 'java-spring-boot' || input.framework === 'java-service') {
    commands.add('java -jar <build-artifact>.jar');
  }
  return Array.from(commands);
}

function detectDeploymentHints(input: {
  framework: ProjectFramework;
  rootFiles: string[];
  outputDir?: string;
  serviceDependencies: string[];
}) {
  const hints = new Set<string>();
  if (input.framework === 'docker-compose') {
    hints.add('Prefer repository-native docker compose deployment');
  }
  if (input.framework === 'dockerfile') {
    hints.add('Prefer repository-native Docker image deployment');
  }
  if (input.framework === 'vite-static' || input.framework === 'react-spa') {
    hints.add(`Build static assets and publish ${input.outputDir || 'dist'} behind nginx`);
  }
  if (input.framework === 'java-spring-boot') {
    hints.add('Build Spring Boot artifact and run it as a systemd service');
  }
  if (input.serviceDependencies.length > 0) {
    hints.add(`Auto-provision local dependencies when possible: ${input.serviceDependencies.join(', ')}`);
  }
  if (input.rootFiles.includes('.env.example')) {
    hints.add('Prefer env-file driven deployment');
  }
  return Array.from(hints);
}

function estimateConfidence(framework: ProjectFramework, evidence: string[]) {
  if (framework === 'unknown') return 0.25;
  if (framework === 'docker-compose' || framework === 'dockerfile') return 0.98;
  if (framework === 'java-spring-boot') return 0.94;
  if (framework === 'java-service') return 0.88;
  return Math.min(0.92, 0.55 + evidence.length * 0.08);
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

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function uniqStrings(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function findReadmeFile(rootFiles: string[]) {
  return rootFiles.find((name) => /^readme(?:\.[^.]+)?$/i.test(name));
}

function summarizeReadme(readme: string | null | undefined) {
  if (!readme) return undefined;
  const lines = readme
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (lines.length === 0) return undefined;
  const summary = lines.join(' ').replace(/\s+/g, ' ').trim();
  return summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
}

function deriveProjectName(rootPath: string) {
  try {
    if (/^https?:\/\//i.test(rootPath)) {
      const url = new URL(rootPath);
      const segment = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop();
      if (segment) return segment.replace(/\.git$/i, '').toLowerCase();
    }
  } catch {
    // Ignore URL parsing failures and fall back to path basename.
  }

  return path.basename(rootPath).replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() || 'app';
}

function extractReadmeInsights(readme: string | null | undefined) {
  const content = readme || '';
  const lower = content.toLowerCase();
  const buildCommands = new Set<string>();
  const startCommands = new Set<string>();
  const deploymentHints = new Set<string>();
  const routeCandidates = new Set<string>();
  const ports = new Set<number>();
  const serviceDependencies = new Set<string>();
  const evidence = new Set<string>();

  for (const port of findPorts(content)) {
    ports.add(port);
  }

  for (const match of content.matchAll(/(?:^|\s)(\/[A-Za-z0-9\-._~\/]+)(?=\s|$)/g)) {
    const normalized = normalizeRoutePath(match[1]);
    if (normalized) routeCandidates.add(normalized);
  }

  const addBuild = (pattern: RegExp, command: string, hint: string) => {
    if (pattern.test(content)) {
      buildCommands.add(command);
      deploymentHints.add(hint);
      evidence.add(`README mentions ${command}`);
    }
  };
  const addStart = (pattern: RegExp, command: string, hint: string) => {
    if (pattern.test(content)) {
      startCommands.add(command);
      deploymentHints.add(hint);
      evidence.add(`README mentions ${command}`);
    }
  };

  if (/docker compose up|docker-compose up/i.test(content)) {
    deploymentHints.add('README recommends Docker Compose deployment');
    evidence.add('README mentions docker compose');
  }
  if (/docker build|docker run/i.test(content)) {
    deploymentHints.add('README recommends Docker image deployment');
    evidence.add('README mentions docker build/run');
  }

  addBuild(/\bnpm\s+run\s+build\b/i, 'npm run build', 'README documents npm build');
  addBuild(/\bpnpm\s+build\b/i, 'pnpm build', 'README documents pnpm build');
  addBuild(/\byarn\s+build\b/i, 'yarn build', 'README documents yarn build');
  addBuild(/\bbun\s+run\s+build\b/i, 'bun run build', 'README documents Bun build');
  addBuild(/\bmvn(?:w)?\s+[^\n\r]*package\b/i, 'mvn -DskipTests package', 'README documents Maven packaging');
  addBuild(/\bgradle(?:w)?\s+[^\n\r]*build\b/i, 'gradle build -x test', 'README documents Gradle build');
  addBuild(/\bpip\s+install\s+-r\s+requirements\.txt\b/i, 'pip install -r requirements.txt', 'README documents pip install');
  addBuild(/\bpoetry\s+install\b/i, 'poetry install', 'README documents poetry install');

  addStart(/\bnpm\s+(?:run\s+)?start\b/i, 'npm run start', 'README documents npm start');
  addStart(/\bpnpm\s+start\b/i, 'pnpm start', 'README documents pnpm start');
  addStart(/\byarn\s+start\b/i, 'yarn start', 'README documents yarn start');
  addStart(/\buvicorn\b/i, 'uvicorn main:app --host 0.0.0.0 --port 8000', 'README documents uvicorn startup');
  addStart(/\bgunicorn\b/i, 'gunicorn app:app', 'README documents gunicorn startup');
  addStart(/\bflask\s+run\b/i, 'flask run --host 0.0.0.0 --port 8000', 'README documents Flask startup');
  addStart(/\bpython\s+manage\.py\s+runserver\b/i, 'python manage.py runserver 0.0.0.0:8000', 'README documents Django startup');
  addStart(/\bjava\s+-jar\b/i, 'java -jar <build-artifact>.jar', 'README documents jar startup');

  if (/postgres|postgresql/i.test(lower)) serviceDependencies.add('postgres');
  if (/mysql/i.test(lower)) serviceDependencies.add('mysql');
  if (/redis/i.test(lower)) serviceDependencies.add('redis');
  if (/mongodb/i.test(lower)) serviceDependencies.add('mongodb');
  if (/kafka/i.test(lower)) serviceDependencies.add('kafka');

  return {
    buildCommands: Array.from(buildCommands),
    startCommands: Array.from(startCommands),
    deploymentHints: Array.from(deploymentHints),
    routeCandidates: Array.from(routeCandidates),
    ports: Array.from(ports),
    serviceDependencies: Array.from(serviceDependencies),
    evidence: Array.from(evidence),
  };
}

function buildProjectSpecFromSnapshot(snapshot: ProjectScanSnapshot): ProjectSpec {
  const rootFiles = snapshot.rootFiles;
  const packageJson = safeParseJson<ProjectSpec['packageJson']>(snapshot.packageJson) || undefined;
  const { framework, evidence } = detectFramework({
    files: rootFiles,
    packageJson,
    dockerfile: snapshot.dockerfile || null,
    dockerCompose: snapshot.dockerCompose || null,
    requirements: snapshot.requirements || null,
    pyproject: snapshot.pyproject || null,
    pomXml: snapshot.pomXml || null,
    gradleFile: snapshot.gradleFile || null,
  });

  const envSource = {
    envContents: snapshot.envContents || [],
    requiredEnvVars: Array.from(
      new Set(
        (snapshot.envContents || []).flatMap((item) => Object.keys(parseEnvText(item.content || ''))),
      ),
    ).sort(),
    suggestedEnvVars: (snapshot.envContents || []).reduce<EnvMap>((acc, item) => {
      const parsed = parseEnvText(item.content || '');
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in acc) || value) acc[key] = value;
      }
      return acc;
    }, {}),
  };
  const sourceEnvUsages = snapshot.sourceEnvUsages || [];
  const scripts = packageJson?.scripts || {};
  const language = detectLanguage(framework);
  const packaging = detectPackaging(framework);
  const packageManager = detectPackageManager(rootFiles);
  const outputDir = detectOutputDir(framework, scripts, rootFiles);
  const readmeInsights = extractReadmeInsights(snapshot.readmeContent);
  const suggestedEnvVars = {
    ...envSource.suggestedEnvVars,
  };
  const requiredEnvVars = Array.from(
    new Set([...envSource.requiredEnvVars, ...sourceEnvUsages]),
  ).sort();
  const dependencyText = [
    snapshot.requirements || '',
    snapshot.pyproject || '',
    snapshot.pomXml || '',
    snapshot.gradleFile || '',
    snapshot.readmeContent || '',
  ].join('\n');
  const serviceDependencies = uniqStrings([
    ...detectServiceDependencies(packageJson, suggestedEnvVars, dependencyText),
    ...readmeInsights.serviceDependencies,
  ]) as ProjectSpec['serviceDependencies'];
  const migrationScripts = detectMigrationScripts(packageJson, rootFiles);
  const migrationCommands = detectMigrationCommands(packageJson, rootFiles);
  const healthCheckCandidates = Array.from(
    new Set([
      ...(snapshot.routeCandidates || []),
      ...readmeInsights.routeCandidates,
      ...DEFAULT_HEALTH_PATHS,
    ]),
  )
    .map((item) => normalizeRoutePath(item) || '')
    .filter(Boolean)
    .sort((a, b) => scoreHealthCandidate(a) - scoreHealthCandidate(b) || a.localeCompare(b))
    .slice(0, 12);
  const persistentPaths = uniqStrings(
    snapshot.persistentPaths && snapshot.persistentPaths.length > 0
      ? snapshot.persistentPaths
      : PERSISTENT_DIR_HINTS.filter((item) => rootFiles.includes(item.split('/')[0])),
  );
  const nodeVersion = extractNodeVersion(packageJson, snapshot.nvmrc || null, snapshot.nodeVersionFile || null);
  const pythonVersion = extractPythonVersion(snapshot.pyproject || null, snapshot.runtimeTxt || null, snapshot.pythonVersionFile || null);
  const javaVersion = extractJavaVersion(snapshot.pomXml || null, snapshot.gradleFile || null);
  const runtimeRequirements = detectRuntimeRequirements({
    framework,
    nodeVersion,
    pythonVersion,
    javaVersion,
    needsNginx:
      framework === 'vite-static' ||
      framework === 'react-spa' ||
      framework === 'node-service' ||
      framework === 'nextjs' ||
      framework === 'python-fastapi' ||
      framework === 'python-flask' ||
      framework === 'python-service' ||
      framework === 'java-spring-boot' ||
      framework === 'java-service',
  });
  const buildCommands = uniqStrings([
    ...detectBuildCommands({
      framework,
      scripts,
      packageManager,
      rootFiles,
    }),
    ...readmeInsights.buildCommands,
  ]);
  const startCommands = uniqStrings([
    ...detectStartCommands({
      framework,
      scripts,
    }),
    ...readmeInsights.startCommands,
  ]);
  const deploymentHints = uniqStrings([
    ...detectDeploymentHints({
      framework,
      rootFiles,
      outputDir,
      serviceDependencies,
    }),
    ...readmeInsights.deploymentHints,
  ]);
  const confidence = Math.min(
    0.99,
    estimateConfidence(framework, evidence) + (snapshot.readmeContent ? 0.03 : 0),
  );
  const readmePath = snapshot.readmePath;
  const readmeSummary = summarizeReadme(snapshot.readmeContent);

  const portSources = [
    packageJson ? JSON.stringify(packageJson) : '',
    snapshot.dockerfile || '',
    snapshot.dockerCompose || '',
    snapshot.requirements || '',
    snapshot.pyproject || '',
    snapshot.pomXml || '',
    snapshot.gradleFile || '',
    snapshot.readmeContent || '',
    ...envSource.envContents.map((item) => item.content),
  ].join('\n');

  const projectName = packageJson?.name || deriveProjectName(snapshot.rootPath);

  return {
    id: crypto.createHash('sha1').update(snapshot.rootPath).digest('hex'),
    rootPath: snapshot.rootPath,
    name: projectName,
    fingerprints: rootFiles,
    framework,
    language,
    packaging,
    packageManager,
    buildCommand: scripts.build || buildCommands[0],
    startCommand: scripts.start || startCommands[0],
    outputDir,
    envFiles: (snapshot.envContents || []).map((item) => item.file),
    ports: uniqNumbers([...findPorts(portSources), ...readmeInsights.ports]),
    evidence: uniqStrings([...evidence, ...readmeInsights.evidence]),
    packageJson,
    files: rootFiles,
    requiredEnvVars,
    suggestedEnvVars,
    serviceDependencies,
    migrationScripts,
    migrationCommands,
    healthCheckCandidates,
    persistentPaths,
    runtimeRequirements,
    buildCommands,
    startCommands,
    deploymentHints,
    confidence,
    readmePath,
    readmeSummary,
  };
}

export class ProjectScanner {
  async resolveProjectRoot(rootPathInput: string): Promise<string> {
    for (const candidate of extractPathCandidates(rootPathInput)) {
      const resolved = await resolveCandidateDirectory(candidate);
      if (resolved) return resolved;
    }
    throw new Error(`Local path does not exist: ${rootPathInput}`);
  }

  async scanSnapshot(snapshot: ProjectScanSnapshot): Promise<ProjectSpec> {
    return buildProjectSpecFromSnapshot(snapshot);
  }

  async scan(rootPathInput: string): Promise<ProjectSpec> {
    const rootPath = await this.resolveProjectRoot(rootPathInput);
    const rootFiles = await listRootFiles(rootPath);
    const readmeFile = findReadmeFile(rootFiles);
    const envFiles = rootFiles.filter((name) => name.startsWith('.env'));
    const envSource = await collectEnvSources(rootPath, envFiles);
    const sourceEnvUsages = await collectSourceEnvUsages(rootPath, rootFiles);
    const healthCheckCandidates = await collectRouteCandidates(rootPath, rootFiles);
    const persistentPaths = await detectPersistentPaths(rootPath);

    return this.scanSnapshot({
      rootPath,
      rootFiles,
      packageJson: await readTextIfExists(path.join(rootPath, 'package.json')),
      dockerfile: await readTextIfExists(path.join(rootPath, 'Dockerfile')),
      dockerCompose:
        (await readTextIfExists(path.join(rootPath, 'docker-compose.yml'))) ||
        (await readTextIfExists(path.join(rootPath, 'compose.yml'))),
      requirements: await readTextIfExists(path.join(rootPath, 'requirements.txt')),
      pyproject: await readTextIfExists(path.join(rootPath, 'pyproject.toml')),
      pomXml: await readTextIfExists(path.join(rootPath, 'pom.xml')),
      gradleFile:
        (await readTextIfExists(path.join(rootPath, 'build.gradle'))) ||
        (await readTextIfExists(path.join(rootPath, 'build.gradle.kts'))),
      nvmrc: await readTextIfExists(path.join(rootPath, '.nvmrc')),
      nodeVersionFile: await readTextIfExists(path.join(rootPath, '.node-version')),
      runtimeTxt: await readTextIfExists(path.join(rootPath, 'runtime.txt')),
      pythonVersionFile: await readTextIfExists(path.join(rootPath, '.python-version')),
      readmePath: readmeFile,
      readmeContent: readmeFile ? await readTextIfExists(path.join(rootPath, readmeFile)) : null,
      envContents: envSource.envContents,
      sourceEnvUsages,
      routeCandidates: healthCheckCandidates,
      persistentPaths,
    });
  }
}
