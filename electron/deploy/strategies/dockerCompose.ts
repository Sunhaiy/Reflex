import { DeployPlan, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { BuildPlanInput, DeployStrategy, shQuote, withContext } from './base.js';

export class DockerComposeStrategy implements DeployStrategy {
  id = 'docker-compose' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return project.framework === 'docker-compose' && server.hasDocker && server.hasDockerCompose;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} with docker compose`,
      releaseId: ctx.releaseId,
      steps: [
        { kind: 'local_scan', id: 'scan', label: 'Analyze project' },
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
        {
          kind: 'ssh_exec',
          id: 'compose-up',
          label: 'Run docker compose',
          command: 'docker compose up -d --build',
          cwd: ctx.releaseDir,
        },
        {
          kind: 'http_verify',
          id: 'verify',
          label: 'Verify application',
          url: finalUrl,
          expectedStatus: 200,
        },
        {
          kind: 'set_output',
          id: 'output',
          label: 'Publish final URL',
          url: finalUrl,
        },
      ],
      rollbackSteps: [],
    };
  }
}
