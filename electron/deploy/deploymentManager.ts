import path from 'path';
import { WebContents } from 'electron';
import { promises as fs } from 'fs';
import Store from 'electron-store';
import {
  CreateDeployDraftInput,
  DeployDraft,
  DeployLogEntry,
  DeployRun,
  DeployStep,
  DeployStepRuntime,
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
import { shQuote } from './strategies/base.js';

interface ActiveRunSession {
  run: DeployRun;
  webContents: WebContents;
  cancelled: boolean;
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
    const project = await this.scanner.scan(input.projectRoot);
    const connection = this.sshMgr.getConnectionConfig(sessionId);
    const server = await this.inspector.inspect(sessionId, connection?.host || 'server');
    const existingProfile = this.deployStore.findProfile(input.serverProfileId, input.projectRoot);
    const draft = this.selector.buildDraft({
      input,
      project,
      server,
      existingProfile,
    });
    this.deployStore.saveProfile(draft.profile);
    return draft;
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
    (async () => {
      const runId = `deploy-run-${Date.now()}`;
      const initialRun: DeployRun = {
        id: runId,
        sessionId,
        serverProfileId: input.serverProfileId,
        projectRoot: input.projectRoot,
        createdAt: now(),
        updatedAt: now(),
        status: 'running',
        phase: 'analyzing_project',
        steps: [],
        logs: [],
        outputs: {},
        warnings: [],
        missingInfo: [],
        rollbackStatus: 'not_needed',
      };

      this.activeRuns.set(sessionId, { run: initialRun, webContents, cancelled: false });
      this.deployStore.saveRun(initialRun);
      this.pushRun(sessionId, webContents, initialRun);

      try {
        const draft = await this.createDraft(sessionId, input);
        const active = this.requireActive(sessionId);
        active.run.projectSpec = draft.projectSpec;
        active.run.serverSpec = draft.serverSpec;
        active.run.profile = draft.profile;
        active.run.warnings = draft.warnings;
        active.run.missingInfo = draft.missingInfo;
        active.run.updatedAt = now();
        this.log(sessionId, webContents, {
          level: 'info',
          message: `Strategy selected: ${draft.strategyId}`,
        });

        const connection = this.sshMgr.getConnectionConfig(sessionId);
        const strategy = this.selector.select(
          draft.projectSpec,
          draft.serverSpec,
          draft.strategyId,
        );
        const plan = await strategy.buildPlan({
          profile: draft.profile,
          project: draft.projectSpec,
          server: draft.serverSpec,
          connectionHost: connection?.host || draft.serverSpec.host,
        });

        active.run.phase = 'planning';
        active.run.plan = plan;
        active.run.outputs.releaseId = plan.releaseId;
        active.run.outputs.strategyId = plan.strategyId;
        active.run.outputs.remoteRoot = draft.profile.remoteRoot;
        active.run.steps = plan.steps.map(stepToRuntime);
        active.run.updatedAt = now();
        this.updateRun(sessionId, webContents);

        for (const step of active.run.steps) {
          this.throwIfCancelled(sessionId);
          await this.executeRuntimeStep(sessionId, webContents, step);
        }

        active.run.phase = 'completed';
        active.run.status = 'completed';
        active.run.updatedAt = now();
        this.updateRun(sessionId, webContents);
        this.finish(sessionId, webContents, active.run);
      } catch (error: any) {
        const active = this.requireActive(sessionId);
        active.run.error = error?.message || String(error);
        active.run.status = active.cancelled ? 'cancelled' : 'failed';
        active.run.phase = active.cancelled ? 'cancelled' : 'failed';
        active.run.updatedAt = now();
        this.log(sessionId, webContents, {
          level: 'error',
          message: active.run.error || 'Deployment failed',
        });

        if (!active.cancelled && active.run.plan?.rollbackSteps?.length) {
          active.run.rollbackStatus = 'running';
          active.run.phase = 'rolling_back';
          active.run.updatedAt = now();
          this.updateRun(sessionId, webContents);
          try {
            await this.rollbackRunner.run(active.run.plan.rollbackSteps, async (step) => {
              await this.executeStep(sessionId, webContents, step);
            });
            active.run.rollbackStatus = 'completed';
            this.log(sessionId, webContents, {
              level: 'success',
              message: 'Rollback completed',
            });
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
      } finally {
        this.activeRuns.delete(sessionId);
      }
    })().catch((error) => {
      console.error('[DeploymentManager] start error:', error);
    });
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
      const result = await this.executeStep(sessionId, webContents, step);
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
        active.run.phase = 'analyzing_project';
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

      case 'sftp_upload':
        active.run.phase = 'uploading';
        this.updateRun(sessionId, webContents);
        await this.sshMgr.uploadFile(sessionId, step.localPath, step.remotePath);
        return `Uploaded ${path.basename(step.localPath)} to ${step.remotePath}`;

      case 'remote_extract':
        active.run.phase = 'executing';
        this.updateRun(sessionId, webContents);
        await this.execRemote(
          sessionId,
          webContents,
          `mkdir -p ${shQuote(step.targetDir)} && tar -xzf ${shQuote(step.archivePath)} -C ${shQuote(
            step.targetDir,
          )} && rm -f ${shQuote(step.archivePath)}`,
          {
            sudo: pathNeedsSudo(step.targetDir),
          },
        );
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
          {
            sudo: pathNeedsSudo(step.currentLink),
          },
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
    let finalCommand = command;
    if (options?.cwd) {
      finalCommand = `cd ${shQuote(options.cwd)} && ${finalCommand}`;
    }
    if (options?.sudo) {
      finalCommand = this.wrapSudo(sessionId, finalCommand, active.run.serverSpec?.sudoMode || 'unavailable');
    }

    if (!webContents.isDestroyed()) {
      webContents.send('terminal-data', {
        id: sessionId,
        data: `\r\n\x1b[35;2m[Deploy] $ ${finalCommand}\x1b[0m\r\n`,
      });
    }
    const result = await this.sshMgr.exec(
      sessionId,
      `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb ${finalCommand}`,
      240000,
    );
    if (!webContents.isDestroyed()) {
      if (result.stdout) {
        webContents.send('terminal-data', {
          id: sessionId,
          data: result.stdout.replace(/\n/g, '\r\n'),
        });
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
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Command failed: ${command}`);
    }
  }

  private wrapSudo(
    sessionId: string,
    command: string,
    sudoMode: 'root' | 'passwordless' | 'unavailable',
  ) {
    if (sudoMode === 'root') return command;
    if (sudoMode === 'passwordless') {
      return `sudo -n bash -lc ${shQuote(command)}`;
    }

    const connection = this.sshMgr.getConnectionConfig(sessionId);
    if (connection?.authType === 'password' && connection.password) {
      return `printf %s ${shQuote(connection.password)} | sudo -S -p '' bash -lc ${shQuote(command)}`;
    }
    throw new Error('This deployment step needs sudo privileges, but sudo is unavailable for the current SSH account');
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
        await this.execRemote(
          sessionId,
          webContents,
          `chmod ${options.mode} ${shQuote(targetPath)}`,
        );
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
