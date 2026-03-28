export type DeploymentStrategyId =
  | 'static-nginx'
  | 'node-systemd'
  | 'next-standalone'
  | 'dockerfile'
  | 'docker-compose'
  | 'python-systemd';

export type ProjectFramework =
  | 'vite-static'
  | 'react-spa'
  | 'nextjs'
  | 'node-service'
  | 'dockerfile'
  | 'docker-compose'
  | 'python-fastapi'
  | 'python-flask'
  | 'python-service'
  | 'unknown';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry';

export interface ProjectSpec {
  id: string;
  rootPath: string;
  name: string;
  fingerprints: string[];
  framework: ProjectFramework;
  packageManager?: PackageManager;
  buildCommand?: string;
  startCommand?: string;
  outputDir?: string;
  envFiles: string[];
  ports: number[];
  evidence: string[];
  packageJson?: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  files: string[];
  requiredEnvVars: string[];
  suggestedEnvVars: Record<string, string>;
  serviceDependencies: string[];
  migrationScripts: string[];
  migrationCommands: string[];
  healthCheckCandidates: string[];
  persistentPaths: string[];
}

export interface ServerSpec {
  host: string;
  user: string;
  homeDir: string;
  os: string;
  arch: string;
  packageManager: 'apt' | 'dnf' | 'yum' | 'apk' | 'unknown';
  hasDocker: boolean;
  hasDockerCompose: boolean;
  hasNginx: boolean;
  hasPm2: boolean;
  hasNode: boolean;
  hasPython: boolean;
  hasSystemd: boolean;
  sudoMode: 'root' | 'passwordless' | 'unavailable';
  openPorts: number[];
  publicIp?: string;
}

export interface DeployProfile {
  id: string;
  serverProfileId: string;
  projectRoot: string;
  appName: string;
  remoteRoot: string;
  domain?: string;
  preferredStrategy?: DeploymentStrategyId;
  runtimePort?: number;
  envVars: Record<string, string>;
  installMissingDependencies: boolean;
  enableHttps: boolean;
  healthCheckPath?: string;
}

export interface DeployStepBase {
  id: string;
  label: string;
}

export interface LocalScanStep extends DeployStepBase {
  kind: 'local_scan';
}

export interface LocalPackStep extends DeployStepBase {
  kind: 'local_pack';
  sourceDir: string;
  outFile: string;
  ignorePatterns?: string[];
}

export interface LocalExecStep extends DeployStepBase {
  kind: 'local_exec';
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SSHExecStep extends DeployStepBase {
  kind: 'ssh_exec';
  command: string;
  cwd?: string;
  sudo?: boolean;
}

export interface SFTPUploadStep extends DeployStepBase {
  kind: 'sftp_upload';
  localPath: string;
  remotePath: string;
}

export interface RemoteWriteFileStep extends DeployStepBase {
  kind: 'remote_write_file';
  path: string;
  content: string;
  sudo?: boolean;
  mode?: string;
}

export interface RemoteExtractStep extends DeployStepBase {
  kind: 'remote_extract';
  archivePath: string;
  targetDir: string;
}

export interface SwitchReleaseStep extends DeployStepBase {
  kind: 'switch_release';
  currentLink: string;
  targetDir: string;
}

export interface HTTPVerifyStep extends DeployStepBase {
  kind: 'http_verify';
  url: string;
  expectedStatus?: number;
}

export interface ServiceVerifyStep extends DeployStepBase {
  kind: 'service_verify';
  serviceName: string;
}

export interface SetOutputStep extends DeployStepBase {
  kind: 'set_output';
  url: string;
}

export type DeployStep =
  | LocalScanStep
  | LocalPackStep
  | LocalExecStep
  | SSHExecStep
  | SFTPUploadStep
  | RemoteWriteFileStep
  | RemoteExtractStep
  | SwitchReleaseStep
  | HTTPVerifyStep
  | ServiceVerifyStep
  | SetOutputStep;

export interface DeployPlan {
  id: string;
  strategyId: DeploymentStrategyId;
  summary: string;
  releaseId: string;
  steps: DeployStep[];
  rollbackSteps: DeployStep[];
}

export type DeployRunStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DeployPhase =
  | 'idle'
  | 'analyzing_project'
  | 'probing_server'
  | 'planning'
  | 'packaging'
  | 'uploading'
  | 'executing'
  | 'verifying'
  | 'rolling_back'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DeployStepRuntime = DeployStep & {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};

export interface DeployLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  stepId?: string;
}

export interface DeployDraft {
  profile: DeployProfile;
  projectSpec: ProjectSpec;
  serverSpec: ServerSpec;
  strategyId: DeploymentStrategyId;
  warnings: string[];
  missingInfo: string[];
}

export interface DeployRunOutput {
  url?: string;
  healthCheckUrl?: string;
  releaseId?: string;
  strategyId?: DeploymentStrategyId;
  serviceName?: string;
  remoteRoot?: string;
}

export interface DeployRun {
  id: string;
  sessionId: string;
  serverProfileId: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  status: DeployRunStatus;
  phase: DeployPhase;
  projectSpec?: ProjectSpec;
  serverSpec?: ServerSpec;
  profile?: DeployProfile;
  plan?: DeployPlan;
  steps: DeployStepRuntime[];
  logs: DeployLogEntry[];
  outputs: DeployRunOutput;
  warnings: string[];
  missingInfo: string[];
  error?: string;
  rollbackStatus?: 'not_needed' | 'pending' | 'running' | 'completed' | 'failed';
}

export interface CreateDeployDraftInput {
  serverProfileId: string;
  projectRoot: string;
  appName?: string;
  domain?: string;
  preferredStrategy?: DeploymentStrategyId;
  runtimePort?: number;
  envVars?: Record<string, string>;
  installMissingDependencies?: boolean;
  enableHttps?: boolean;
  healthCheckPath?: string;
}

export interface StartDeployInput extends CreateDeployDraftInput {
  sessionId: string;
}
