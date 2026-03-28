import { DeployPlan, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { renderProxyNginxConfig } from '../templates/nginx.js';
import { renderEnvTemplate } from '../templates/env.js';
import { renderSystemdService } from '../templates/systemd.js';
import {
  BuildPlanInput,
  DeployStrategy,
  buildEnsureNginxCommand,
  buildEnsureNodeCommand,
  buildEnsureNodePackageManagerCommand,
  canProvideNodeRuntime,
  installCommand,
  shQuote,
  withOptionalEnvFile,
  withContext,
} from './base.js';

export class NextStandaloneStrategy implements DeployStrategy {
  id = 'next-standalone' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return project.framework === 'nextjs' && canProvideNodeRuntime(server) && server.hasSystemd;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const install = installCommand(ctx.project.packageManager);
    const envFilePath = `${ctx.sharedDir}/.env`;
    const runtimeEnvFilePath = Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined;
    const serviceFilePath = `/etc/systemd/system/${ctx.serviceName}`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;
    const runtimeProvisionSteps = buildRuntimeProvisionSteps(ctx.server, Boolean(ctx.profile.domain));
    const packageManagerProvisionSteps = buildPackageManagerProvisionSteps(ctx.project.packageManager);
    const migrationSteps = buildMigrationSteps(ctx.project.migrationCommands, runtimeEnvFilePath, ctx.releaseDir);

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} as Next.js app`,
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
          command: `mkdir -p ${shQuote(`${ctx.profile.remoteRoot}/releases`)} ${shQuote(ctx.sharedDir)}`,
          sudo: true,
        },
        ...runtimeProvisionSteps,
        ...packageManagerProvisionSteps,
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
              sudo: true,
              content: renderEnvTemplate(ctx.profile.envVars),
            }]
          : []),
        {
          kind: 'ssh_exec',
          id: 'install',
          label: 'Install dependencies',
          command: install,
          cwd: ctx.releaseDir,
        },
        {
          kind: 'ssh_exec',
          id: 'build',
          label: 'Build Next.js app',
          command: withOptionalEnvFile('npm run build', runtimeEnvFilePath),
          cwd: ctx.releaseDir,
        },
        ...migrationSteps,
        {
          kind: 'ssh_exec',
          id: 'snapshot-current',
          label: 'Snapshot current release',
          command: `if [ -L ${shQuote(ctx.currentDir)} ]; then PREV="$(readlink -f ${shQuote(ctx.currentDir)})"; printf "%s" "$PREV" > ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)}; fi`,
          sudo: true,
        },
        {
          kind: 'switch_release',
          id: 'switch',
          label: 'Switch current release',
          currentLink: ctx.currentDir,
          targetDir: ctx.releaseDir,
        },
        {
          kind: 'remote_write_file',
          id: 'systemd',
          label: 'Write systemd service',
          path: serviceFilePath,
          sudo: true,
          content: renderSystemdService({
            description: `${ctx.profile.appName} Next.js service`,
            workingDirectory: ctx.currentDir,
            user: ctx.server.user,
            environmentFile: Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined,
            execStart: `/bin/bash -lc ${shQuote(`PORT=${runtimePort} npm run start`)}`,
          }),
        },
        {
          kind: 'ssh_exec',
          id: 'systemd-reload',
          label: 'Reload and restart service',
          command: `systemctl daemon-reload && systemctl enable ${shQuote(ctx.serviceName)} && systemctl restart ${shQuote(ctx.serviceName)}`,
          sudo: true,
        },
        {
          kind: 'service_verify',
          id: 'service-verify',
          label: 'Verify service status',
          serviceName: ctx.serviceName,
        },
        ...(ctx.profile.domain && ctx.server.hasNginx
          ? [
              {
                kind: 'remote_write_file' as const,
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
                kind: 'ssh_exec' as const,
                id: 'nginx-reload',
                label: 'Reload Nginx',
                command: 'nginx -t && systemctl reload nginx',
                sudo: true,
              },
            ]
          : []),
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
      rollbackSteps: [
        {
          kind: 'ssh_exec',
          id: 'rollback-switch',
          label: 'Restore previous release',
          command: `if [ -f ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)} ]; then PREV="$(cat ${shQuote(`${ctx.profile.remoteRoot}/.previous_release`)})"; ln -sfn "$PREV" ${shQuote(ctx.currentDir)}; fi`,
          sudo: true,
        },
        {
          kind: 'ssh_exec',
          id: 'rollback-service',
          label: 'Restart service',
          command: `systemctl restart ${shQuote(ctx.serviceName)}`,
          sudo: true,
        },
      ],
    };
  }
}

function buildPackageManagerProvisionSteps(packageManager?: ProjectSpec['packageManager']) {
  const ensurePackageManager = buildEnsureNodePackageManagerCommand(packageManager);
  if (!ensurePackageManager) return [] as DeployPlan['steps'];
  return [
    {
      kind: 'ssh_exec' as const,
      id: 'install-package-manager',
      label: `Install ${packageManager} package manager`,
      command: ensurePackageManager,
    },
  ] as DeployPlan['steps'];
}

function buildMigrationSteps(commands: string[], envFilePath: string | undefined, cwd: string) {
  return commands.map((command, index) => ({
    kind: 'ssh_exec' as const,
    id: `migrate-${index + 1}`,
    label: `Run migration: ${command}`,
    command: withOptionalEnvFile(command, envFilePath),
    cwd,
  })) as DeployPlan['steps'];
}

function buildRuntimeProvisionSteps(server: ServerSpec, needsNginx: boolean) {
  const steps: DeployPlan['steps'] = [];
  const ensureNode = !server.hasNode ? buildEnsureNodeCommand(server) : null;
  if (ensureNode) {
    steps.push({
      kind: 'ssh_exec',
      id: 'install-node',
      label: 'Install Node.js runtime',
      command: ensureNode,
      sudo: true,
    });
  }

  if (needsNginx) {
    const ensureNginx = !server.hasNginx ? buildEnsureNginxCommand(server) : null;
    if (ensureNginx) {
      steps.push({
        kind: 'ssh_exec',
        id: 'install-nginx',
        label: 'Install Nginx',
        command: ensureNginx,
        sudo: true,
      });
    }
  }

  return steps;
}
