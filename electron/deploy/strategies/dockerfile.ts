import { DeployPlan, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { renderProxyNginxConfig } from '../templates/nginx.js';
import { renderEnvTemplate } from '../templates/env.js';
import { BuildPlanInput, DeployStrategy, shQuote, withContext } from './base.js';

export class DockerfileStrategy implements DeployStrategy {
  id = 'dockerfile' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return project.framework === 'dockerfile' && server.hasDocker;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const containerName = ctx.profile.appName;
    const imageName = `${ctx.profile.appName}:${ctx.releaseId}`;
    const envFilePath = `${ctx.releaseDir}/.env`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;

    const steps: DeployPlan['steps'] = [
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
      ...(Object.keys(ctx.profile.envVars).length > 0
        ? [{
            kind: 'remote_write_file' as const,
            id: 'env',
            label: 'Write env file',
            path: envFilePath,
            content: renderEnvTemplate(ctx.profile.envVars),
          }]
        : []),
      {
        kind: 'ssh_exec',
        id: 'docker-build',
        label: 'Build container image',
        command: `docker build -t ${shQuote(imageName)} .`,
        cwd: ctx.releaseDir,
      },
      {
        kind: 'ssh_exec',
        id: 'docker-run',
        label: 'Restart container',
        command: `docker rm -f ${shQuote(containerName)} >/dev/null 2>&1 || true && docker run -d --name ${shQuote(containerName)} --restart unless-stopped -p ${runtimePort}:${runtimePort}${Object.keys(ctx.profile.envVars).length > 0 ? ` --env-file ${shQuote(envFilePath)}` : ''} ${shQuote(imageName)}`,
      },
    ];

    if (ctx.profile.domain && ctx.server.hasNginx) {
      steps.push(
        {
          kind: 'remote_write_file',
          id: 'nginx-config',
          label: 'Write Nginx config',
          path: ctx.nginxConfigPath,
          sudo: true,
          content: renderProxyNginxConfig({
            serverName: ctx.profile.domain,
            targetPort: runtimePort,
          }),
        },
        {
          kind: 'ssh_exec',
          id: 'nginx-reload',
          label: 'Reload Nginx',
          command: 'nginx -t && systemctl reload nginx',
          sudo: true,
        },
      );
    }

    steps.push(
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
    );

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} from Dockerfile`,
      releaseId: ctx.releaseId,
      steps,
      rollbackSteps: [],
    };
  }
}
