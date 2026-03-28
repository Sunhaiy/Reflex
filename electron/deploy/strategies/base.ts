import path from 'path';
import {
  DeployPlan,
  DeployProfile,
  DeploymentStrategyId,
  PackageManager,
  ProjectSpec,
  ServerSpec,
} from '../../../src/shared/deployTypes.js';

export interface BuildPlanInput {
  profile: DeployProfile;
  project: ProjectSpec;
  server: ServerSpec;
  connectionHost: string;
}

export interface StrategyBuildContext extends BuildPlanInput {
  releaseId: string;
  releaseDir: string;
  currentDir: string;
  sharedDir: string;
  archiveLocalPath: string;
  archiveRemotePath: string;
  serviceName: string;
  nginxConfigPath: string;
  finalUrl: string;
}

export interface DeployStrategy {
  id: DeploymentStrategyId;
  supports(project: ProjectSpec, server: ServerSpec): boolean;
  buildPlan(input: BuildPlanInput): Promise<DeployPlan>;
}

export function sanitizeAppName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function resolveReleasePaths(profile: DeployProfile, connectionHost: string): StrategyBuildContext {
  const appName = sanitizeAppName(profile.appName);
  const remoteRoot = profile.remoteRoot || `/opt/zq-apps/${appName}`;
  const releaseId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const releaseDir = `${remoteRoot}/releases/${releaseId}`;
  const currentDir = `${remoteRoot}/current`;
  const sharedDir = `${remoteRoot}/shared`;
  const archiveName = `${appName}-${releaseId}.tar.gz`;
  const archiveLocalPath = path.join(profile.projectRoot, '.zangqing', archiveName);
  const archiveRemotePath = `/tmp/${archiveName}`;
  const serviceName = `${appName}.service`;
  const nginxConfigPath = `/etc/nginx/conf.d/${appName}.conf`;
  const finalUrl = profile.domain
    ? `${profile.enableHttps ? 'https' : 'http'}://${profile.domain}${profile.healthCheckPath || ''}`
    : `http://${connectionHost}${profile.runtimePort ? `:${profile.runtimePort}` : ''}${profile.healthCheckPath || ''}`;

  return {
    profile,
    project: {} as BuildPlanInput['project'],
    server: {} as BuildPlanInput['server'],
    connectionHost,
    releaseId,
    releaseDir,
    currentDir,
    sharedDir,
    archiveLocalPath,
    archiveRemotePath,
    serviceName,
    nginxConfigPath,
    finalUrl,
  };
}

export function renderEnvFile(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function withContext(input: BuildPlanInput): StrategyBuildContext {
  const ctx = resolveReleasePaths(input.profile, input.connectionHost);
  return {
    ...ctx,
    profile: input.profile,
    project: input.project,
    server: input.server,
  };
}

export function installCommand(packageManager?: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      return 'yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
    case 'poetry':
      return 'poetry install';
    case 'pip':
      return 'pip install -r requirements.txt';
    case 'npm':
    default:
      return 'npm install';
  }
}

export function canInstallSystemPackages(server: ServerSpec): boolean {
  return server.sudoMode !== 'unavailable' && server.packageManager !== 'unknown';
}

export function canProvideNodeRuntime(server: ServerSpec): boolean {
  return server.hasNode || canInstallSystemPackages(server);
}

export function canProvidePythonRuntime(server: ServerSpec): boolean {
  return server.hasPython || canInstallSystemPackages(server);
}

export function canProvideNginx(server: ServerSpec): boolean {
  return server.hasNginx || canInstallSystemPackages(server);
}

export function installSystemPackagesCommand(server: ServerSpec, packages: string[]): string | null {
  const uniquePackages = Array.from(new Set(packages.filter(Boolean)));
  if (uniquePackages.length === 0) return null;

  switch (server.packageManager) {
    case 'apt':
      return `export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y ${uniquePackages.join(' ')}`;
    case 'dnf':
      return `dnf install -y ${uniquePackages.join(' ')}`;
    case 'yum':
      return `yum install -y ${uniquePackages.join(' ')}`;
    case 'apk':
      return `apk add --no-cache ${uniquePackages.join(' ')}`;
    default:
      return null;
  }
}

export function buildEnsureNodeCommand(server: ServerSpec): string | null {
  const install = installSystemPackagesCommand(server, ['nodejs', 'npm']);
  if (!install) return null;
  return `if ! command -v node >/dev/null 2>&1; then ${install}; fi`;
}

export function buildEnsureNginxCommand(server: ServerSpec): string | null {
  const install = installSystemPackagesCommand(server, ['nginx']);
  if (!install) return null;
  const hasSystemd = server.hasSystemd;
  return [
    `if ! command -v nginx >/dev/null 2>&1; then ${install}; fi`,
    hasSystemd ? 'systemctl enable nginx >/dev/null 2>&1 || true' : '',
    hasSystemd ? 'systemctl start nginx >/dev/null 2>&1 || true' : '',
  ]
    .filter(Boolean)
    .join(' && ');
}

export function buildEnsureNodePackageManagerCommand(packageManager?: PackageManager): string | null {
  switch (packageManager) {
    case 'pnpm':
      return 'corepack enable && corepack prepare pnpm@latest --activate';
    case 'yarn':
      return 'corepack enable && corepack prepare yarn@stable --activate';
    default:
      return null;
  }
}

export function buildEnsurePythonCommand(server: ServerSpec): string | null {
  const packageMap: Record<ServerSpec['packageManager'], string[]> = {
    apt: ['python3', 'python3-venv', 'python3-pip'],
    dnf: ['python3', 'python3-pip'],
    yum: ['python3', 'python3-pip'],
    apk: ['python3', 'py3-pip'],
    unknown: [],
  };
  const install = installSystemPackagesCommand(server, packageMap[server.packageManager]);
  if (!install) return null;
  return `if ! command -v python3 >/dev/null 2>&1; then ${install}; fi`;
}

export function startCommand(project: ProjectSpec, runtimePort?: number): string {
  const portPrefix = runtimePort ? `PORT=${runtimePort} ` : '';
  if (project.startCommand) return `${portPrefix}${project.startCommand}`;
  if (project.framework === 'nextjs') return `${portPrefix}npm run start`;
  if (project.framework === 'node-service') return `${portPrefix}npm start`;
  return `${portPrefix}node server.js`;
}

export function withOptionalEnvFile(command: string, envFilePath?: string): string {
  if (!envFilePath) return command;
  return `set -a && . ${shQuote(envFilePath)} && set +a && ${command}`;
}

export function buildCommand(project: ProjectSpec): string | null {
  if (project.buildCommand) return project.buildCommand;
  if (project.framework === 'nextjs') return 'npm run build';
  if (project.framework === 'vite-static' || project.framework === 'react-spa') return 'npm run build';
  return null;
}
