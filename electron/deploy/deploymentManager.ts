import path from 'path';
import { WebContents } from 'electron';
import { promises as fs } from 'fs';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import Store from 'electron-store';
import {
  CreateDeployDraftInput,
  DeployDraft,
  DeployFailureEntry,
  DeployLogEntry,
  DeployRun,
  DeployStep,
  DeployStepRuntime,
  FailureClass,
  StartDeployInput,
} from '../../src/shared/deployTypes.js';
import { SSHManager } from '../ssh/sshManager.js';
import { ProjectScanner } from './projectScanner.js';
import { ServerInspector } from './serverInspector.js';
import { StrategySelector } from './strategySelector.js';
import { DeployStore } from './deployStore.js';
import { Verifier } from './verifier.js';
import { RollbackRunner } from './rollback.js';
import { createArchive } from './packager/archivePackager.js';
import { buildEnsureGitCommand, DeployStrategy, sanitizeAppName, shQuote, toPosixPath } from './strategies/base.js';
import { ResolvedDeploySource, SourceResolver } from './sourceResolver.js';

const execFile = promisify(execFileCallback);
const DEFAULT_HEALTH_CHECK_PATHS = ['/health', '/api/health', '/healthz', '/api/ping', '/ping'];
const MAX_REPAIR_ATTEMPTS = 5;

interface ActiveRunSession {
  run: DeployRun;
  webContents: WebContents;
  cancelled: boolean;
}

export interface DeployAnalysisResult {
  source: ResolvedDeploySource['source'];
  resolvedCheckout?: ResolvedDeploySource['resolvedCheckout'];
  projectRoot: string;
  sourceKey: string;
  projectSpec: Awaited<ReturnType<ProjectScanner['scan']>>;
  serverSpec: Awaited<ReturnType<ServerInspector['inspect']>>;
}

function now() {
  return Date.now();
}

function logId() {
  return `deploy-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pathNeedsSudo(targetPath: string): boolean {
  return ['/opt/', '/etc/', '/usr/', '/var/'].some((prefix) => targetPath.startsWith(prefix));
}

function stepToRuntime(step: DeployStep): DeployStepRuntime {
  return { ...step, status: 'pending' };
}

export class DeploymentManager {
  private scanner = new ProjectScanner();
  private inspector: ServerInspector;
  private selector = new StrategySelector();
  private deployStore: DeployStore;
  private verifier: Verifier;
  private rollbackRunner = new RollbackRunner();
  private sourceResolver = new SourceResolver();
  private activeRuns = new Map<string, ActiveRunSession>();

  constructor(private sshMgr: SSHManager, store: Store) {
    this.inspector = new ServerInspector(sshMgr);
    this.deployStore = new DeployStore(store);
    this.verifier = new Verifier(sshMgr);
  }

  async analyzeProject(projectRoot: string) {
    return this.scanner.scan(projectRoot);
  }

  async probeServer(sessionId: string, fallbackHost: string) {
    return this.inspector.inspect(sessionId, fallbackHost);
  }

  async createDraft(sessionId: string, input: CreateDeployDraftInput): Promise<DeployDraft> {
    const resolvedSource = await this.resolveSource(input);
    return this.createDraftFromResolved(sessionId, input, resolvedSource);
  }

  async analyzeSource(
    sessionId: string,
    input: Pick<CreateDeployDraftInput, 'projectRoot' | 'source'>,
  ): Promise<DeployAnalysisResult> {
    const resolvedSource = await this.resolveSource(input);
    const connection = this.sshMgr.getConnectionConfig(sessionId);
    const serverSpec = await this.inspector.inspect(sessionId, connection?.host || 'server');
    const projectSpec = await this.scanResolvedSource(sessionId, resolvedSource, serverSpec);
    return {
      source: resolvedSource.source,
      resolvedCheckout: resolvedSource.resolvedCheckout,
      projectRoot: resolvedSource.projectRoot,
      sourceKey: resolvedSource.sourceKey,
      projectSpec,
      serverSpec,
    };
  }

  listRuns(serverProfileId?: string) {
    return this.deployStore.listRuns(serverProfileId);
  }

  getRun(runId: string) {
    return this.deployStore.getRun(runId);
  }

  cancel(sessionId: string) {
    const active = this.activeRuns.get(sessionId);
    if (active) {
      active.cancelled = true;
      active.run.status = 'cancelled';
      active.run.phase = 'cancelled';
      active.run.updatedAt = now();
      this.deployStore.saveRun(active.run);
      this.pushRun(sessionId, active.webContents, active.run);
    }
  }

  start(sessionId: string, webContents: WebContents, input: StartDeployInput): void {
    const task = input.resumeRunId
      ? this.resumeBlocking(sessionId, webContents, input.resumeRunId)
      : this.runBlocking(sessionId, webContents, input);
    task.catch((error) => {
      console.error('[DeploymentManager] start error:', error);
    });
  }

  async runBlocking(
    sessionId: string,
    webContents: WebContents,
    input: StartDeployInput,
  ): Promise<DeployRun> {
    const normalizedSource = this.sourceResolver.normalize(input);
    const runId = `deploy-run-${Date.now()}`;
    const initialRun: DeployRun = {
      id: runId,
      sessionId,
      serverProfileId: input.serverProfileId,
      projectRoot: input.projectRoot,
      createdAt: now(),
      updatedAt: now(),
      status: 'running',
      phase: 'resolving_source',
      source: normalizedSource,
      attemptCount: 0,
      failureHistory: [],
      steps: [],
      logs: [],
      outputs: {
        sourceUrl: normalizedSource.type === 'github' ? normalizedSource.url : undefined,
      },
      warnings: [],
      missingInfo: [],
      rollbackStatus: 'not_needed',
      resumeState: {
        nextStepIndex: 0,
        completedStepIds: [],
      },
    };

    this.activeRuns.set(sessionId, { run: initialRun, webContents, cancelled: false });
    this.deployStore.saveRun(initialRun);
    this.pushRun(sessionId, webContents, initialRun);

    try {
      const resolvedSource = await this.resolveSource(input);
      const active = this.requireActive(sessionId);
      active.run.source = resolvedSource.source;
      active.run.projectRoot = resolvedSource.projectRoot;
      active.run.resolvedCheckout = resolvedSource.resolvedCheckout;
      active.run.phase = 'detecting_project';
      this.updateRun(sessionId, webContents);

      const draft = await this.createDraftFromResolved(sessionId, input, resolvedSource);
      const strategy = this.selector.select(draft.projectSpec, draft.serverSpec, draft.strategyId);
      const connection = this.sshMgr.getConnectionConfig(sessionId);
      const plan = await strategy.buildPlan({
        profile: draft.profile,
        project: draft.projectSpec,
        server: draft.serverSpec,
        connectionHost: connection?.host || draft.serverSpec.host,
        source: draft.source,
        resolvedCheckout: draft.resolvedCheckout,
      });

      active.run.phase = 'planning';
      active.run.projectSpec = draft.projectSpec;
      active.run.serverSpec = draft.serverSpec;
      active.run.profile = draft.profile;
      active.run.projectRoot = resolvedSource.projectRoot;
      active.run.warnings = draft.warnings;
      active.run.missingInfo = draft.missingInfo;
      active.run.chosenStrategy = strategy.id;
      active.run.plan = plan;
      active.run.outputs.releaseId = plan.releaseId;
      active.run.outputs.strategyId = plan.strategyId;
      active.run.outputs.remoteRoot = draft.profile.remoteRoot;
      active.run.steps = plan.steps.map(stepToRuntime);
      active.run.resumeState = {
        nextStepIndex: 0,
        nextStepId: active.run.steps[0]?.id,
        completedStepIds: [],
        lockedStrategyId: strategy.id,
        sourceKey: resolvedSource.sourceKey,
      };
      this.log(sessionId, webContents, { level: 'info', message: `Strategy locked: ${strategy.id}` });
      this.updateRun(sessionId, webContents);

      await this.executePlanWithRepairs(sessionId, webContents, strategy, 0);

      active.run.phase = 'completed';
      active.run.status = 'completed';
      active.run.currentStep = undefined;
      active.run.error = undefined;
      this.updateRun(sessionId, webContents);
      this.finish(sessionId, webContents, active.run);
      return active.run;
    } catch (error: any) {
      return await this.failRun(sessionId, webContents, error);
    } finally {
      this.activeRuns.delete(sessionId);
    }
  }

  async resumeBlocking(sessionId: string, webContents: WebContents, runId: string): Promise<DeployRun> {
    const storedRun = this.deployStore.getRun(runId);
    if (!storedRun) {
      throw new Error(`Deploy run not found: ${runId}`);
    }
    if (storedRun.status === 'completed' || storedRun.status === 'cancelled') {
      return storedRun;
    }

    const activeRun: DeployRun = {
      ...storedRun,
      status: 'running',
      phase: storedRun.attemptCount > 0 ? 'repairing' : 'executing',
      updatedAt: now(),
    };

    this.activeRuns.set(sessionId, { run: activeRun, webContents, cancelled: false });
    this.deployStore.saveRun(activeRun);
    this.pushRun(sessionId, webContents, activeRun);

    try {
      if (activeRun.source) {
        const resolvedSource = await this.resolveSource({
          projectRoot: activeRun.projectRoot,
          source: activeRun.source,
        });
        activeRun.projectRoot = resolvedSource.projectRoot;
        activeRun.resolvedCheckout = resolvedSource.resolvedCheckout;
        if (activeRun.profile) activeRun.profile.projectRoot = resolvedSource.projectRoot;
      }

      if (!activeRun.projectSpec || !activeRun.serverSpec || !activeRun.profile || !activeRun.plan) {
        throw new Error('Deploy run cannot be resumed because its saved context is incomplete');
      }

      const strategy = this.selector.select(
        activeRun.projectSpec,
        activeRun.serverSpec,
        activeRun.chosenStrategy || activeRun.plan.strategyId,
      );
      const startIndex = this.findResumeIndex(activeRun);
      await this.executePlanWithRepairs(sessionId, webContents, strategy, startIndex);

      activeRun.phase = 'completed';
      activeRun.status = 'completed';
      activeRun.currentStep = undefined;
      activeRun.error = undefined;
      this.updateRun(sessionId, webContents);
      this.finish(sessionId, webContents, activeRun);
      return activeRun;
    } catch (error: any) {
      return await this.failRun(sessionId, webContents, error);
    } finally {
      this.activeRuns.delete(sessionId);
    }
  }

  private async resolveSource(input: { projectRoot: string; source?: StartDeployInput['source'] }): Promise<ResolvedDeploySource> {
    return this.sourceResolver.resolve(input);
  }

  private async createDraftFromResolved(
    sessionId: string,
    input: CreateDeployDraftInput,
    resolvedSource: ResolvedDeploySource,
  ): Promise<DeployDraft> {
    const connection = this.sshMgr.getConnectionConfig(sessionId);
    const server = await this.inspector.inspect(sessionId, connection?.host || 'server');
    const project = await this.scanResolvedSource(sessionId, resolvedSource, server);
    const normalizedInput = {
      ...input,
      projectRoot: resolvedSource.projectRoot,
    };
    const existingProfile = this.deployStore.findProfile(
      normalizedInput.serverProfileId,
      resolvedSource.sourceKey,
    );
    const draft = this.selector.buildDraft({
      input: normalizedInput,
      project,
      server,
      existingProfile,
    });
    draft.profile.projectRoot = resolvedSource.projectRoot;
    draft.profile.sourceKey = resolvedSource.sourceKey;
    this.deployStore.saveProfile(draft.profile);

    return {
      ...draft,
      source: resolvedSource.source,
      resolvedCheckout: resolvedSource.resolvedCheckout,
    };
  }

  private async scanResolvedSource(
    sessionId: string,
    resolvedSource: ResolvedDeploySource,
    server: Awaited<ReturnType<ServerInspector['inspect']>>,
  ) {
    if (resolvedSource.source.type === 'local') {
      return this.scanner.scan(resolvedSource.projectRoot);
    }
    return this.scanGitHubSourceOnRemote(sessionId, resolvedSource, server);
  }

  private buildRemoteAnalysisRoot(sourceKey: string) {
    const digest = Buffer.from(sourceKey).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 24).toLowerCase();
    return `/tmp/reflex-source-cache/${digest}`;
  }

  private async ensureRemoteGitAnalysisCheckout(
    sessionId: string,
    resolvedSource: ResolvedDeploySource,
    server: Awaited<ReturnType<ServerInspector['inspect']>>,
  ) {
    const checkout = resolvedSource.resolvedCheckout;
    if (!checkout || resolvedSource.source.type !== 'github') {
      throw new Error('Remote analysis checkout requires a GitHub source');
    }

    const analysisRoot = this.buildRemoteAnalysisRoot(resolvedSource.sourceKey);
    const ensureGit = buildEnsureGitCommand(server);
    const cloneCommand =
      checkout.ref && checkout.ref !== 'HEAD'
        ? `git clone --depth 1 --branch ${shQuote(checkout.ref)} ${shQuote(checkout.repoUrl)} ${shQuote(analysisRoot)}`
        : `git clone --depth 1 ${shQuote(checkout.repoUrl)} ${shQuote(analysisRoot)}`;

    const command = [
      `mkdir -p ${shQuote(path.posix.dirname(analysisRoot))}`,
      ...(ensureGit ? [ensureGit] : []),
      `rm -rf ${shQuote(analysisRoot)}`,
      cloneCommand,
      `git -C ${shQuote(analysisRoot)} rev-parse HEAD`,
    ].join(' && ');
    const shellScript = [
      'export PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb',
      command,
    ].join('; ');
    const sudoMode = this.activeRuns.get(sessionId)?.run.serverSpec?.sudoMode || server.sudoMode;
    const finalCommand = pathNeedsSudo(analysisRoot)
      ? this.wrapSudo(sessionId, shellScript, sudoMode)
      : `sh -lc ${shQuote(shellScript)}`;
    const result = await this.sshMgr.exec(sessionId, finalCommand, 240000);
    const commit = result.stdout.trim().split(/\r?\n/).pop()?.trim();
    checkout.analysisRemotePath = analysisRoot;
    if (commit) {
      checkout.commit = commit;
    }
    const projectDir =
      resolvedSource.source.subdir
        ? `${analysisRoot}/${toPosixPath(resolvedSource.source.subdir)}`
        : analysisRoot;
    return {
      analysisRoot,
      projectDir,
      commit,
    };
  }

  private async readRemoteFileSafe(sessionId: string, remotePath: string) {
    try {
      return await this.sshMgr.readFile(sessionId, remotePath);
    } catch {
      try {
        const result = await this.sshMgr.exec(
          sessionId,
          `sh -lc ${shQuote(`if [ -f ${shQuote(remotePath)} ]; then cat ${shQuote(remotePath)}; fi`)}`,
          30000,
        );
        return result.stdout || null;
      } catch {
        return null;
      }
    }
  }

  private async remoteDirectoryExists(sessionId: string, remotePath: string) {
    try {
      const result = await this.sshMgr.exec(
        sessionId,
        `sh -lc ${shQuote(`test -d ${shQuote(remotePath)} && printf "yes" || printf "no"`)}`,
        20000,
      );
      return result.stdout.trim() === 'yes';
    } catch {
      return false;
    }
  }

  private async scanGitHubSourceOnRemote(
    sessionId: string,
    resolvedSource: ResolvedDeploySource,
    server: Awaited<ReturnType<ServerInspector['inspect']>>,
  ) {
    const checkout = await this.ensureRemoteGitAnalysisCheckout(sessionId, resolvedSource, server);
    const rootEntries = await this.sshMgr.listFiles(sessionId, checkout.projectDir);
    const rootFiles = rootEntries.map((entry) => entry.name);
    const readmeFile = rootFiles.find((name) => /^readme(?:\.[^.]+)?$/i.test(name));
    const envFiles = rootFiles.filter((name) => name.startsWith('.env'));
    const envContents = await Promise.all(
      envFiles.map(async (file) => ({
        file,
        content: (await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/${file}`)) || '',
      })),
    );

    const persistentPaths = (
      await Promise.all(
        [
          'uploads',
          'upload',
          'storage',
          'data',
          'tmp',
          'logs',
          'public/uploads',
          'public/storage',
        ].map(async (relativePath) => (
          (await this.remoteDirectoryExists(sessionId, `${checkout.projectDir}/${relativePath}`))
            ? relativePath
            : null
        )),
      )
    ).filter((item): item is string => Boolean(item));

    const project = await this.scanner.scanSnapshot({
      rootPath: resolvedSource.projectRoot,
      rootFiles,
      packageJson: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/package.json`),
      dockerfile: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/Dockerfile`),
      dockerCompose:
        (await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/docker-compose.yml`)) ||
        (await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/compose.yml`)),
      requirements: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/requirements.txt`),
      pyproject: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/pyproject.toml`),
      pomXml: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/pom.xml`),
      gradleFile:
        (await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/build.gradle`)) ||
        (await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/build.gradle.kts`)),
      nvmrc: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/.nvmrc`),
      nodeVersionFile: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/.node-version`),
      runtimeTxt: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/runtime.txt`),
      pythonVersionFile: await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/.python-version`),
      readmePath: readmeFile,
      readmeContent: readmeFile
        ? await this.readRemoteFileSafe(sessionId, `${checkout.projectDir}/${readmeFile}`)
        : null,
      envContents,
      persistentPaths,
    });

    return project;
  }

  private findResumeIndex(run: DeployRun) {
    if (typeof run.resumeState?.nextStepIndex === 'number') {
      return Math.max(0, Math.min(run.resumeState.nextStepIndex, run.steps.length));
    }
    const firstPending = run.steps.findIndex((step) => step.status !== 'completed');
    return firstPending === -1 ? run.steps.length : firstPending;
  }

  private async executePlanWithRepairs(
    sessionId: string,
    webContents: WebContents,
    strategy: DeployStrategy,
    startIndex: number,
  ) {
    const active = this.requireActive(sessionId);

    for (let index = startIndex; index < active.run.steps.length; ) {
      this.throwIfCancelled(sessionId);
      const step = active.run.steps[index];
      active.run.currentStep = { index, id: step.id, label: step.label };
      active.run.resumeState = {
        ...(active.run.resumeState || { completedStepIds: [] }),
        nextStepIndex: index,
        nextStepId: step.id,
        lockedStrategyId: strategy.id,
      };
      this.updateRun(sessionId, webContents);

      try {
        await this.executeRuntimeStep(sessionId, webContents, step);
        active.run.resumeState = {
          ...(active.run.resumeState || { completedStepIds: [] }),
          nextStepIndex: index + 1,
          nextStepId: active.run.steps[index + 1]?.id,
          completedStepIds: Array.from(
            new Set([...(active.run.resumeState?.completedStepIds || []), step.id]),
          ),
          lockedStrategyId: strategy.id,
        };
        index += 1;
        continue;
      } catch (error: any) {
        const failureClass = this.classifyFailure(step, error);
        const repairAttempt = active.run.attemptCount + 1;
        const failureEntry: DeployFailureEntry = {
          attempt: repairAttempt,
          failureClass,
          stepId: step.id,
          message: error?.message || String(error),
          timestamp: now(),
        };
        active.run.failureHistory = [...active.run.failureHistory, failureEntry].slice(-20);
        active.run.attemptCount = repairAttempt;
        active.run.phase = 'repairing';
        active.run.error = error?.message || String(error);
        this.log(sessionId, webContents, {
          level: 'warn',
          message: `Repair attempt ${repairAttempt}/${MAX_REPAIR_ATTEMPTS}: ${failureClass}`,
          stepId: step.id,
        });
        this.updateRun(sessionId, webContents);

        if (repairAttempt > MAX_REPAIR_ATTEMPTS) {
          throw error;
        }

        const repairSteps = strategy.repairRules({
          profile: active.run.profile!,
          project: active.run.projectSpec!,
          server: active.run.serverSpec!,
          connectionHost: active.run.serverSpec?.host || active.run.outputs.url || '',
          releaseId: active.run.plan!.releaseId,
          releaseDir: this.findReleaseDir(active.run),
          currentDir: `${active.run.profile!.remoteRoot}/current`,
          sharedDir: `${active.run.profile!.remoteRoot}/shared`,
          archiveLocalPath: this.findArchiveLocalPath(active.run),
          archiveRemotePath: this.findArchiveRemotePath(active.run),
          serviceName: `${sanitizeAppName(active.run.profile!.appName)}.service`,
          nginxConfigPath: `/etc/nginx/conf.d/${sanitizeAppName(active.run.profile!.appName)}.conf`,
          finalUrl:
            active.run.outputs.healthCheckUrl ||
            active.run.outputs.url ||
            `http://${active.run.serverSpec?.host}`,
          source: active.run.source,
          resolvedCheckout: active.run.resolvedCheckout,
          projectDir:
            active.run.source?.type === 'github' && active.run.source.subdir
              ? `${this.findReleaseDir(active.run)}/${toPosixPath(active.run.source.subdir)}`
              : this.findReleaseDir(active.run),
          run: active.run,
          plan: active.run.plan!,
          failedStep: step,
          failureClass,
          attempt: repairAttempt,
        });

        if (repairSteps.length > 0) {
          for (const repairStep of repairSteps) {
            this.throwIfCancelled(sessionId);
            const result = await this.executeStep(sessionId, webContents, repairStep);
            this.log(sessionId, webContents, {
              level: 'info',
              message: `${repairStep.label}: ${result}`,
              stepId: step.id,
            });
          }
          failureEntry.repairSummary = repairSteps.map((item) => item.label).join(', ');
        } else {
          failureEntry.repairSummary = 'No deterministic repair action matched; retrying current step';
        }

        step.status = 'pending';
        delete step.error;
        delete step.result;
        delete step.startedAt;
        delete step.finishedAt;
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
      }
    }
  }

  private classifyFailure(step: DeployStepRuntime, error: Error): FailureClass {
    const message = `${error.message}\n${step.id}\n${step.label}`.toLowerCase();
    if (/failed to clone|invalid github|checkout|fetch head|subdirectory not found/.test(message)) {
      return 'source_checkout_failed';
    }
    if (/serveroverloaded|toomanyrequests|429/.test(message)) {
      return 'llm_overloaded';
    }
    if (step.kind === 'http_verify') {
      return 'health_check_failed';
    }
    if (/address already in use|eaddrinuse|port is already allocated|bind: address already in use/.test(message)) {
      return 'port_conflict';
    }
    if (/docker compose|docker-compose.*command not found|'compose' is not a docker command/.test(message)) {
      return 'compose_variant_mismatch';
    }
    if (/unsupported engine|requires node|requires python|requires java|version mismatch/.test(message)) {
      return 'runtime_version_mismatch';
    }
    if (/command not found|node: not found|python: not found|python3: not found|java: command not found|docker: command not found/.test(message)) {
      return 'runtime_missing';
    }
    if (step.id.includes('docker-build') || /docker build/.test(message)) {
      return 'docker_build_failed';
    }
    if (step.id.includes('docker-run') || step.id.includes('compose-up')) {
      return 'docker_run_failed';
    }
    if (/missing env|environment variable|env var|dotenv|database_url|redis_url|keyerror/.test(message)) {
      return 'env_missing';
    }
    if (/connection refused|ecconnrefused|could not connect|postgres|mysql|redis|mongodb|kafka/.test(message)) {
      return 'dependency_service_missing';
    }
    if (/nginx/.test(message)) {
      return 'proxy_failed';
    }
    if (step.kind === 'service_verify' || /systemctl|service .* is /.test(message)) {
      return 'service_boot_failed';
    }
    if (step.id.includes('build') || step.id.includes('install') || /build failed|compilation|npm err|gradle|maven/.test(message)) {
      return 'build_failed';
    }
    return 'unknown';
  }

  private findReleaseDir(run: DeployRun) {
    const releaseId = run.outputs.releaseId || run.plan?.releaseId || 'current';
    return `${run.profile?.remoteRoot || '/opt/zq-apps/app'}/releases/${releaseId}`;
  }

  private findArchiveLocalPath(run: DeployRun) {
    const archiveName = `${run.profile?.appName || 'app'}-${run.outputs.releaseId || run.plan?.releaseId || 'current'}.tar.gz`;
    if (run.source?.type === 'github' || /^https?:\/\//i.test(run.projectRoot)) {
      return path.join(process.cwd(), '.reflex', 'tmp', archiveName);
    }
    return path.join(run.projectRoot, '.reflex', archiveName);
  }

  private findArchiveRemotePath(run: DeployRun) {
    const archiveName = `${run.profile?.appName || 'app'}-${run.outputs.releaseId || run.plan?.releaseId || 'current'}.tar.gz`;
    return `/tmp/${archiveName}`;
  }

  private async failRun(sessionId: string, webContents: WebContents, error: any): Promise<DeployRun> {
    const active = this.requireActive(sessionId);
    active.run.error = error?.message || String(error);
    active.run.status = active.cancelled ? 'cancelled' : 'failed';
    active.run.phase = active.cancelled ? 'cancelled' : 'failed';
    this.log(sessionId, webContents, {
      level: 'error',
      message: active.run.error || 'Deployment failed',
    });

    if (!active.cancelled && active.run.plan?.rollbackSteps?.length) {
      active.run.rollbackStatus = 'running';
      active.run.phase = 'rolling_back';
      this.updateRun(sessionId, webContents);
      try {
        await this.rollbackRunner.run(active.run.plan.rollbackSteps, async (step) => {
          await this.executeStep(sessionId, webContents, step);
        });
        active.run.rollbackStatus = 'completed';
        this.log(sessionId, webContents, { level: 'success', message: 'Rollback completed' });
      } catch (rollbackError: any) {
        active.run.rollbackStatus = 'failed';
        this.log(sessionId, webContents, {
          level: 'error',
          message: `Rollback failed: ${rollbackError?.message || rollbackError}`,
        });
      }
    }

    this.updateRun(sessionId, webContents);
    this.finish(sessionId, webContents, active.run);
    return active.run;
  }

  private requireActive(sessionId: string): ActiveRunSession {
    const active = this.activeRuns.get(sessionId);
    if (!active) throw new Error('No active deployment run');
    return active;
  }

  private throwIfCancelled(sessionId: string) {
    const active = this.requireActive(sessionId);
    if (active.cancelled) {
      throw new Error('Deployment cancelled');
    }
  }

  private pushRun(sessionId: string, webContents: WebContents, run: DeployRun) {
    if (!webContents.isDestroyed()) {
      webContents.send('deploy-run-update', { sessionId, run });
    }
  }

  private finish(sessionId: string, webContents: WebContents, run: DeployRun) {
    if (!webContents.isDestroyed()) {
      webContents.send('deploy-run-finished', { sessionId, run });
    }
  }

  private log(
    sessionId: string,
    webContents: WebContents,
    entry: Omit<DeployLogEntry, 'id' | 'timestamp'>,
  ) {
    const active = this.requireActive(sessionId);
    const fullEntry: DeployLogEntry = {
      id: logId(),
      timestamp: now(),
      ...entry,
    };
    active.run.logs = [...active.run.logs, fullEntry].slice(-300);
    active.run.updatedAt = now();
    this.deployStore.saveRun(active.run);
    if (!webContents.isDestroyed()) {
      webContents.send('deploy-run-log', {
        sessionId,
        runId: active.run.id,
        entry: fullEntry,
      });
      webContents.send('deploy-run-update', { sessionId, run: active.run });
    }
  }

  private updateRun(sessionId: string, webContents: WebContents) {
    const active = this.requireActive(sessionId);
    active.run.updatedAt = now();
    this.deployStore.saveRun(active.run);
    this.pushRun(sessionId, webContents, active.run);
  }

  private async executeRuntimeStep(
    sessionId: string,
    webContents: WebContents,
    step: DeployStepRuntime,
  ) {
    step.status = 'running';
    step.startedAt = now();
    this.updateRun(sessionId, webContents);
    this.log(sessionId, webContents, {
      level: 'info',
      message: step.label,
      stepId: step.id,
    });

    try {
      let result: string;
      try {
        result = await this.executeStep(sessionId, webContents, step);
      } catch (error: any) {
        const recovered = await this.tryRecoverStep(sessionId, webContents, step, error);
        if (!recovered) throw error;
        this.log(sessionId, webContents, {
          level: 'warn',
          message: recovered,
          stepId: step.id,
        });
        result = await this.executeStep(sessionId, webContents, step);
      }
      step.status = 'completed';
      step.finishedAt = now();
      step.result = result;
      this.log(sessionId, webContents, {
        level: 'success',
        message: result || `${step.label} completed`,
        stepId: step.id,
      });
    } catch (error: any) {
      step.status = 'failed';
      step.finishedAt = now();
      step.error = error?.message || String(error);
      this.updateRun(sessionId, webContents);
      throw error;
    }

    this.updateRun(sessionId, webContents);
  }

  private async tryRecoverStep(
    sessionId: string,
    webContents: WebContents,
    step: DeployStepRuntime,
    error: Error,
  ): Promise<string | null> {
    if (step.kind === 'service_verify') {
      await this.execRemote(
        sessionId,
        webContents,
        `systemctl restart ${shQuote(step.serviceName)} && sleep 3`,
        { sudo: true },
      );
      return `Auto-restarted ${step.serviceName} after verification failure`;
    }

    if (step.kind !== 'http_verify') return null;

    const active = this.requireActive(sessionId);
    const project = active.run.projectSpec;
    if (!project) return null;

    let currentUrl: URL;
    try {
      currentUrl = new URL(step.url);
    } catch {
      return null;
    }

    const candidateUrls = Array.from(
      new Set(
        [step.url, ...(project.healthCheckCandidates || []), ...DEFAULT_HEALTH_CHECK_PATHS].map((value) => {
          if (/^https?:\/\//i.test(value)) return value;
          const normalizedPath = value.startsWith('/') ? value : `/${value}`;
          return new URL(normalizedPath, `${currentUrl.protocol}//${currentUrl.host}`).toString();
        }),
      ),
    );
    const recovered = await this.verifier.findHealthyUrl(
      sessionId,
      candidateUrls,
      step.expectedStatus || 200,
    );
    if (!recovered || recovered.url === step.url) return null;

    step.url = recovered.url;
    active.run.outputs.healthCheckUrl = recovered.url;
    active.run.outputs.url = recovered.url;
    if (active.run.profile) {
      active.run.profile.healthCheckPath = new URL(recovered.url).pathname || '/';
      this.deployStore.saveProfile(active.run.profile);
    }
    const outputStep = active.run.steps.find(
      (item): item is DeployStepRuntime & { kind: 'set_output' } => item.kind === 'set_output',
    );
    if (outputStep) outputStep.url = recovered.url;
    this.updateRun(sessionId, webContents);

    return `Auto-switched health check to ${recovered.url} after ${error.message}`;
  }

  private async executeStep(
    sessionId: string,
    webContents: WebContents,
    step: DeployStep,
  ): Promise<string> {
    const active = this.requireActive(sessionId);
    const profile = active.run.profile;
    const server = active.run.serverSpec;
    if (!profile || !server) throw new Error('Deployment context is incomplete');

    switch (step.kind) {
      case 'local_scan':
        active.run.phase = 'detecting_project';
        this.updateRun(sessionId, webContents);
        return `Project ${active.run.projectSpec?.name || 'project'} analyzed`;

      case 'local_pack':
        active.run.phase = 'packaging';
        this.updateRun(sessionId, webContents);
        await fs.mkdir(path.dirname(step.outFile), { recursive: true });
        await createArchive({
          rootPath: step.sourceDir,
          outFile: step.outFile,
          extraIgnorePatterns: step.ignorePatterns,
        });
        return `Archive created at ${step.outFile}`;

      case 'local_exec':
        active.run.phase = 'packaging';
        this.updateRun(sessionId, webContents);
        await this.execLocal(step.command, { cwd: step.cwd, env: step.env });
        return `Executed locally: ${step.command}`;

      case 'remote_git_checkout':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        await this.execRemote(
          sessionId,
          webContents,
          [
            `mkdir -p ${shQuote(path.posix.dirname(step.targetDir))}`,
            `rm -rf ${shQuote(step.targetDir)}`,
            step.ref && step.ref !== 'HEAD'
              ? `git clone --depth 1 --branch ${shQuote(step.ref)} ${shQuote(step.repoUrl)} ${shQuote(step.targetDir)}`
              : `git clone --depth 1 ${shQuote(step.repoUrl)} ${shQuote(step.targetDir)}`,
          ].join(' && '),
          { sudo: pathNeedsSudo(step.targetDir) },
        );
        return `Fetched ${step.repoUrl} to ${step.targetDir}`;

      case 'sftp_upload':
        active.run.phase = 'uploading';
        this.updateRun(sessionId, webContents);
        await this.sshMgr.uploadFile(sessionId, step.localPath, step.remotePath);
        return `Uploaded ${path.basename(step.localPath)} to ${step.remotePath}`;

      case 'remote_extract':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        {
          const needsSudo = pathNeedsSudo(step.targetDir);
          const ownershipFix =
            needsSudo && server.user && server.user !== 'root'
              ? ` && chown -R ${shQuote(`${server.user}:${server.user}`)} ${shQuote(step.targetDir)}`
              : '';
          await this.execRemote(
            sessionId,
            webContents,
            `mkdir -p ${shQuote(step.targetDir)} && tar -xzf ${shQuote(step.archivePath)} -C ${shQuote(step.targetDir)} && rm -f ${shQuote(step.archivePath)}${ownershipFix}`,
            { sudo: needsSudo },
          );
        }
        return `Extracted archive to ${step.targetDir}`;

      case 'ssh_exec':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        await this.execRemote(sessionId, webContents, step.command, {
          cwd: step.cwd,
          sudo: step.sudo,
        });
        return `Executed: ${step.command}`;

      case 'remote_write_file':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        await this.writeRemoteFile(sessionId, webContents, step.path, step.content, {
          sudo: step.sudo,
          mode: step.mode,
        });
        return `Updated ${step.path}`;

      case 'switch_release':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        await this.execRemote(
          sessionId,
          webContents,
          `ln -sfn ${shQuote(step.targetDir)} ${shQuote(step.currentLink)}`,
          { sudo: pathNeedsSudo(step.currentLink) },
        );
        return `Current release now points to ${step.targetDir}`;

      case 'service_verify':
        active.run.phase = 'verifying';
        this.updateRun(sessionId, webContents);
        return await this.verifier.verifyService(sessionId, step.serviceName);

      case 'http_verify':
        active.run.phase = 'verifying';
        this.updateRun(sessionId, webContents);
        return await this.verifier.verifyHttp(sessionId, step.url, step.expectedStatus || 200);

      case 'set_output':
        active.run.outputs.url = step.url;
        active.run.outputs.healthCheckUrl = step.url;
        this.updateRun(sessionId, webContents);
        return `Final URL: ${step.url}`;
    }
  }

  private async execRemote(
    sessionId: string,
    webContents: WebContents,
    command: string,
    options?: { cwd?: string; sudo?: boolean },
  ) {
    const active = this.requireActive(sessionId);
    const shellScript = [
      'export PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb',
      options?.cwd ? `cd ${shQuote(options.cwd)}` : '',
      command,
    ]
      .filter(Boolean)
      .join('; ');
    const displayCommand = [
      options?.sudo ? 'sudo' : '',
      options?.cwd ? `cd ${shQuote(options.cwd)} &&` : '',
      command,
    ]
      .filter(Boolean)
      .join(' ');
    const finalCommand = options?.sudo
      ? this.wrapSudo(sessionId, shellScript, active.run.serverSpec?.sudoMode || 'unavailable')
      : `sh -lc ${shQuote(shellScript)}`;

    if (!webContents.isDestroyed()) {
      webContents.send('terminal-data', {
        id: sessionId,
        data: `\r\n\x1b[35;2m[Deploy] $ ${displayCommand}\x1b[0m\r\n`,
      });
    }
    const result = await this.sshMgr.exec(sessionId, finalCommand, 240000);
    if (!webContents.isDestroyed()) {
      if (result.stdout) {
        webContents.send('terminal-data', { id: sessionId, data: result.stdout.replace(/\n/g, '\r\n') });
      }
      if (result.stderr) {
        webContents.send('terminal-data', {
          id: sessionId,
          data: `\x1b[33m${result.stderr.replace(/\n/g, '\r\n')}\x1b[0m`,
        });
      }
      webContents.send('terminal-data', {
        id: sessionId,
        data: `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`,
      });
    }
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.stdout.trim() ||
          `Command failed with exit code ${result.exitCode}: ${displayCommand}`,
      );
    }
  }

  private wrapSudo(
    sessionId: string,
    shellScript: string,
    sudoMode: 'root' | 'passwordless' | 'unavailable',
  ) {
    if (sudoMode === 'root') return `sh -lc ${shQuote(shellScript)}`;
    if (sudoMode === 'passwordless') {
      return `sudo -n sh -lc ${shQuote(shellScript)}`;
    }

    const connection = this.sshMgr.getConnectionConfig(sessionId);
    if (connection?.authType === 'password' && connection.password) {
      return `printf %s ${shQuote(connection.password)} | sudo -S -p '' sh -lc ${shQuote(shellScript)}`;
    }
    throw new Error('This deployment step needs sudo privileges, but sudo is unavailable for the current SSH account');
  }

  private async execLocal(
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
  ) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
    const shellArgs = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];

    try {
      await execFile(shell, shellArgs, {
        cwd: options?.cwd,
        env: {
          ...process.env,
          ...(options?.env || {}),
        },
        timeout: 1000 * 60 * 20,
        maxBuffer: 1024 * 1024 * 8,
        windowsHide: true,
      });
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr) : '';
      const stdout = error?.stdout ? String(error.stdout) : '';
      throw new Error(stderr || stdout || error?.message || String(error));
    }
  }

  private async writeRemoteFile(
    sessionId: string,
    webContents: WebContents,
    targetPath: string,
    content: string,
    options?: { sudo?: boolean; mode?: string },
  ) {
    if (!options?.sudo) {
      const dir = path.posix.dirname(targetPath);
      await this.execRemote(sessionId, webContents, `mkdir -p ${shQuote(dir)}`);
      await this.sshMgr.writeFile(sessionId, targetPath, content);
      if (options?.mode) {
        await this.execRemote(sessionId, webContents, `chmod ${options.mode} ${shQuote(targetPath)}`);
      }
      return;
    }

    const tempPath = `/tmp/${path.posix.basename(targetPath)}.${Date.now()}.tmp`;
    const base64 = Buffer.from(content, 'utf8').toString('base64');
    const command = [
      `mkdir -p ${shQuote(path.posix.dirname(targetPath))}`,
      `printf %s ${shQuote(base64)} | base64 -d > ${shQuote(tempPath)}`,
      `mv ${shQuote(tempPath)} ${shQuote(targetPath)}`,
      options.mode ? `chmod ${options.mode} ${shQuote(targetPath)}` : '',
    ]
      .filter(Boolean)
      .join(' && ');

    await this.execRemote(sessionId, webContents, command, { sudo: true });
  }
}
