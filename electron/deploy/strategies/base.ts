import path from 'path';
import {
  DeployRun,
  DeployPlan,
  DeployProfile,
  DeployStep,
  DeployStepRuntime,
  DeploySource,
  DeploymentStrategyId,
  FailureClass,
  PackageManager,
  ProjectSpec,
  ResolvedCheckout,
  ServerSpec,
} from '../../../src/shared/deployTypes.js';

export interface BuildPlanInput {
  profile: DeployProfile;
  project: ProjectSpec;
  server: ServerSpec;
  connectionHost: string;
  source?: DeploySource;
  resolvedCheckout?: ResolvedCheckout;
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
  source?: DeploySource;
  resolvedCheckout?: ResolvedCheckout;
  projectDir: string;
}

export interface StrategyRepairContext extends StrategyBuildContext {
  run: DeployRun;
  plan: DeployPlan;
  failedStep?: DeployStepRuntime;
  failureClass: FailureClass;
  attempt: number;
}

export interface DeployStrategy {
  id: DeploymentStrategyId;
  supports(project: ProjectSpec, server: ServerSpec): boolean;
  score(project: ProjectSpec, server: ServerSpec): number;
  buildPlan(input: BuildPlanInput): Promise<DeployPlan>;
  repairRules(context: StrategyRepairContext): DeployStep[];
  verifyTargets(context: StrategyBuildContext): { urls: string[]; services: string[] };
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

type ReleasePathsContext = Omit<StrategyBuildContext, 'source' | 'resolvedCheckout' | 'projectDir'>;

export function resolveReleasePaths(
  profile: DeployProfile,
  connectionHost: string,
): ReleasePathsContext {
  const appName = sanitizeAppName(profile.appName);
  const remoteRoot = profile.remoteRoot || `/opt/zq-apps/${appName}`;
  const releaseId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const releaseDir = `${remoteRoot}/releases/${releaseId}`;
  const currentDir = `${remoteRoot}/current`;
  const sharedDir = `${remoteRoot}/shared`;
  const archiveName = `${appName}-${releaseId}.tar.gz`;
  const archiveLocalPath = path.join(profile.projectRoot, '.reflex', archiveName);
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
  const subdir = input.source?.type === 'github' && input.source.subdir
    ? toPosixPath(input.source.subdir)
    : '';
  return {
    ...ctx,
    profile: input.profile,
    project: input.project,
    server: input.server,
    source: input.source,
    resolvedCheckout: input.resolvedCheckout,
    projectDir: subdir ? `${ctx.releaseDir}/${subdir}` : ctx.releaseDir,
  };
}

export function buildGitCheckoutStep(ctx: StrategyBuildContext): DeployStep | null {
  if (ctx.source?.type !== 'github' || !ctx.resolvedCheckout) return null;
  return {
    kind: 'remote_git_checkout',
    id: 'remote-source',
    label: 'Fetch source from GitHub',
    repoUrl: ctx.resolvedCheckout.repoUrl,
    ref: ctx.resolvedCheckout.ref,
    subdir: ctx.source.subdir,
    targetDir: ctx.releaseDir,
  };
}

export function buildArchiveTransferSteps(ctx: StrategyBuildContext): DeployStep[] {
  const gitCheckout = buildGitCheckoutStep(ctx);
  if (gitCheckout) {
    const ensureGit = buildEnsureGitCommand(ctx.server);
    return [
      {
        kind: 'ssh_exec',
        id: 'prepare',
        label: 'Prepare release directories',
        command: `mkdir -p ${shQuote(`${ctx.profile.remoteRoot}/releases`)}`,
        sudo: true,
      },
      ...(ensureGit
        ? [{
            kind: 'ssh_exec' as const,
            id: 'install-git',
            label: 'Install Git',
            command: ensureGit,
            sudo: true,
          }]
        : []),
      gitCheckout,
    ];
  }

  return [
    {
      kind: 'local_pack',
      id: 'pack',
      label: 'Pack project',
      sourceDir: ctx.profile.projectRoot,
      outFile: ctx.archiveLocalPath,
    },
    {
      kind: 'ssh_exec',
      id: 'prepare',
      label: 'Prepare release directories',
      command: `mkdir -p ${shQuote(`${ctx.profile.remoteRoot}/releases`)}`,
      sudo: true,
    },
    {
      kind: 'sftp_upload',
      id: 'upload',
      label: 'Upload release archive',
      localPath: ctx.archiveLocalPath,
      remotePath: ctx.archiveRemotePath,
    },
    {
      kind: 'remote_extract',
      id: 'extract',
      label: 'Extract release',
      archivePath: ctx.archiveRemotePath,
      targetDir: ctx.releaseDir,
    },
  ];
}

export function buildEnsureGitCommand(server: ServerSpec): string | null {
  const install = installSystemPackagesCommand(server, ['git']);
  if (!install) return null;
  return `if ! command -v git >/dev/null 2>&1; then ${install}; fi`;
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

export function buildEnsureDockerComposeCommand(server: ServerSpec): string | null {
  if (server.dockerComposeVariant !== 'none') return null;
  switch (server.packageManager) {
    case 'apt':
      return 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y docker-compose-plugin';
    case 'dnf':
    case 'yum':
      return 'yum install -y docker-compose-plugin || dnf install -y docker-compose-plugin || yum install -y docker-compose';
    case 'apk':
      return 'apk add --no-cache docker-cli-compose';
    default:
      return null;
  }
}

export function buildEnsureDockerCommand(server: ServerSpec): string | null {
  switch (server.packageManager) {
    case 'apt':
      return 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y docker.io';
    case 'dnf':
      return 'dnf install -y docker docker-cli containerd.io';
    case 'yum':
      return 'yum install -y docker docker-cli containerd.io';
    case 'apk':
      return 'apk add --no-cache docker docker-cli';
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

export function buildEnsureJavaCommand(server: ServerSpec, version?: string): string | null {
  const targetVersion = version?.replace(/[^\d]/g, '') || '17';
  switch (server.packageManager) {
    case 'apt':
      return `export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y openjdk-${targetVersion}-jdk maven gradle`;
    case 'dnf':
    case 'yum':
      return `yum install -y java-${targetVersion}-openjdk-devel maven gradle || dnf install -y java-${targetVersion}-openjdk-devel maven gradle`;
    case 'apk':
      return 'apk add --no-cache openjdk17 maven gradle';
    default:
      return null;
  }
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
