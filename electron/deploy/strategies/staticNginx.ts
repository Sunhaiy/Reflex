import { DeployPlan, ProjectSpec, ServerSpec } from '../../../src/shared/deployTypes.js';
import { renderStaticNginxConfig } from '../templates/nginx.js';
import { renderEnvTemplate } from '../templates/env.js';
import {
  BuildPlanInput,
  DeployStrategy,
  buildCommand,
  installCommand,
  shQuote,
  withContext,
} from './base.js';

export class StaticNginxStrategy implements DeployStrategy {
  id = 'static-nginx' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return (
      (project.framework === 'vite-static' || project.framework === 'react-spa') &&
      server.hasNginx &&
      server.hasNode
    );
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const install = installCommand(ctx.project.packageManager);
    const build = buildCommand(ctx.project) || 'npm run build';
    const outputDir = ctx.project.outputDir || 'dist';
    const serverName = ctx.profile.domain || '_';

    return {
      id: `deploy-plan-${Date.now()}`,
      strategyId: this.id,
      summary: `Deploy ${ctx.project.name} as static site via Nginx`,
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
              path: `${ctx.releaseDir}/.env`,
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
          label: 'Build static assets',
          command: build,
          cwd: ctx.releaseDir,
        },
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
          id: 'nginx-config',
          label: 'Write Nginx config',
          path: ctx.nginxConfigPath,
          sudo: true,
          content: renderStaticNginxConfig({
            serverName,
            root: `${ctx.currentDir}/${outputDir}`,
          }),
        },
        {
          kind: 'ssh_exec',
          id: 'nginx-reload',
          label: 'Reload Nginx',
          command: 'nginx -t && systemctl reload nginx',
          sudo: true,
        },
        {
          kind: 'http_verify',
          id: 'verify',
          label: 'Verify website',
          url: ctx.finalUrl,
          expectedStatus: 200,
        },
        {
          kind: 'set_output',
          id: 'output',
          label: 'Publish final URL',
          url: ctx.finalUrl,
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
          id: 'rollback-nginx',
          label: 'Reload Nginx',
          command: 'nginx -t && systemctl reload nginx',
          sudo: true,
        },
      ],
    };
  }
}
