import {
  CreateDeployDraftInput,
  DeployDraft,
  DeployProfile,
  DeploymentStrategyId,
  ProjectSpec,
  ServerSpec,
} from '../../src/shared/deployTypes.js';
import { sanitizeAppName } from './strategies/base.js';
import { DeployStrategy } from './strategies/base.js';
import { StaticNginxStrategy } from './strategies/staticNginx.js';
import { NodeSystemdStrategy } from './strategies/nodeSystemd.js';
import { NextStandaloneStrategy } from './strategies/nextStandalone.js';
import { DockerfileStrategy } from './strategies/dockerfile.js';
import { DockerComposeStrategy } from './strategies/dockerCompose.js';
import { PythonSystemdStrategy } from './strategies/pythonSystemd.js';

export class StrategySelector {
  private strategies: DeployStrategy[] = [
    new DockerComposeStrategy(),
    new DockerfileStrategy(),
    new NextStandaloneStrategy(),
    new StaticNginxStrategy(),
    new NodeSystemdStrategy(),
    new PythonSystemdStrategy(),
  ];

  select(project: ProjectSpec, server: ServerSpec, preferred?: DeploymentStrategyId): DeployStrategy {
    if (preferred) {
      const candidate = this.strategies.find((strategy) => strategy.id === preferred);
      if (candidate && candidate.supports(project, server)) {
        return candidate;
      }
    }

    const strategy = this.strategies.find((item) => item.supports(project, server));
    if (!strategy) {
      throw new Error(`No supported deployment strategy for project "${project.framework}" on this server`);
    }
    return strategy;
  }

  buildDraft(params: {
    input: CreateDeployDraftInput;
    project: ProjectSpec;
    server: ServerSpec;
    existingProfile?: DeployProfile | null;
  }): DeployDraft {
    const suggestedPort = Number(params.project.suggestedEnvVars.PORT || 0);
    const inputEnvVars =
      params.input.envVars && Object.keys(params.input.envVars).length > 0
        ? params.input.envVars
        : undefined;
    const existingEnvVars =
      params.existingProfile?.envVars && Object.keys(params.existingProfile.envVars).length > 0
        ? params.existingProfile.envVars
        : undefined;
    const baseAppName = sanitizeAppName(
      params.input.appName || params.existingProfile?.appName || params.project.name,
    );
    const prefersRootHealthCheck =
      params.project.framework === 'vite-static' ||
      params.project.framework === 'react-spa' ||
      params.project.framework === 'nextjs';
    const defaultHealthCheckPath =
      prefersRootHealthCheck ? '/' : params.project.healthCheckCandidates[0] || '/health';
    const profile: DeployProfile = {
      id: params.existingProfile?.id || `deploy-profile-${Date.now()}`,
      serverProfileId: params.input.serverProfileId,
      projectRoot: params.input.projectRoot,
      appName: baseAppName,
      remoteRoot:
        params.existingProfile?.remoteRoot || `/opt/zq-apps/${sanitizeAppName(baseAppName)}`,
      domain: params.input.domain ?? params.existingProfile?.domain,
      preferredStrategy: params.input.preferredStrategy ?? params.existingProfile?.preferredStrategy,
      runtimePort:
        params.input.runtimePort ??
        params.existingProfile?.runtimePort ??
        (suggestedPort > 0 ? suggestedPort : undefined) ??
        params.project.ports[0] ??
        (params.project.framework.startsWith('python') ? 8000 : 3000),
      envVars: inputEnvVars ?? existingEnvVars ?? params.project.suggestedEnvVars ?? {},
      installMissingDependencies:
        params.input.installMissingDependencies ??
        params.existingProfile?.installMissingDependencies ??
        true,
      enableHttps: params.input.enableHttps ?? params.existingProfile?.enableHttps ?? false,
      healthCheckPath:
        params.input.healthCheckPath ??
        params.existingProfile?.healthCheckPath ??
        defaultHealthCheckPath,
    };

    const warnings: string[] = [];
    const missingInfo: string[] = [];
    const canAutoProvisionLocalPostgres =
      params.project.serviceDependencies.includes('postgres') &&
      ['localhost', '127.0.0.1'].includes(params.project.suggestedEnvVars.DB_HOST || profile.envVars.DB_HOST || '') &&
      (params.server.hasDocker || (params.server.packageManager === 'apt' && params.server.sudoMode !== 'unavailable'));

    if (params.project.framework === 'unknown') {
      missingInfo.push('Project type could not be identified automatically');
    }
    if (params.project.framework === 'node-service' && !params.server.hasNode && params.server.sudoMode === 'unavailable') {
      missingInfo.push('Node.js is missing on the server and cannot be installed automatically without sudo');
    }
    if (
      params.project.framework === 'nextjs' &&
      !params.server.hasNode &&
      params.server.sudoMode === 'unavailable'
    ) {
      missingInfo.push('Node.js is missing on the server and cannot be installed automatically without sudo');
    }
    if (
      params.project.framework.startsWith('python') &&
      !params.server.hasPython &&
      params.server.sudoMode === 'unavailable'
    ) {
      missingInfo.push('Python is missing on the server and cannot be installed automatically without sudo');
    }
    if (profile.enableHttps && !profile.domain) {
      missingInfo.push('A domain is required to configure HTTPS');
    }
    if (params.project.envFiles.includes('.env.example') && Object.keys(profile.envVars).length === 0) {
      warnings.push('Project has .env.example but no deploy env vars were provided');
    }
    const missingEnvVars = params.project.requiredEnvVars.filter((key) => !profile.envVars[key]);
    if (missingEnvVars.length > 0) {
      missingInfo.push(`Missing env vars: ${missingEnvVars.slice(0, 10).join(', ')}`);
    }
    if (params.project.serviceDependencies.length > 0) {
      if (canAutoProvisionLocalPostgres) {
        warnings.push(
          'Detected a local PostgreSQL dependency. The deployer will provision and start PostgreSQL on the target server automatically before verifying the app.',
        );
      } else {
        warnings.push(
          `Detected service dependencies: ${params.project.serviceDependencies.join(', ')}. Make sure these services already exist and are reachable from the server.`,
        );
      }
    }
    if (
      !canAutoProvisionLocalPostgres &&
      params.project.serviceDependencies.some(
        (item) => item === 'postgres' || item === 'mysql' || item === 'database',
      ) &&
      ['localhost', '127.0.0.1'].includes(profile.envVars.DB_HOST || '')
    ) {
      warnings.push(
        'Database host is set to localhost. This only works if the database is running on the target server with the same port and credentials.',
      );
    }
    if (params.project.migrationScripts.length > 0) {
      warnings.push(
        `Migration scripts detected (${params.project.migrationScripts.join(', ')}). The deployer will try to run migrations automatically before restarting the application.`,
      );
    }
    if (params.project.healthCheckCandidates.length > 0) {
      warnings.push(
        `Detected health check candidates: ${params.project.healthCheckCandidates.slice(0, 5).join(', ')}.`,
      );
    }
    if (params.project.persistentPaths.length > 0) {
      warnings.push(
        `Persistent directories detected: ${params.project.persistentPaths.join(', ')}. They will be linked into the shared deployment directory when supported by the strategy.`,
      );
    }
    if (!profile.domain) {
      warnings.push('No domain set. Final URL will use the SSH host and port');
    } else if (!params.server.hasNginx && params.server.sudoMode !== 'unavailable') {
      warnings.push('Nginx is missing on the server and will be installed automatically for reverse proxying');
    }
    if (
      (params.project.framework === 'node-service' || params.project.framework === 'nextjs') &&
      !params.server.hasNode &&
      params.server.sudoMode !== 'unavailable'
    ) {
      warnings.push('Node.js runtime is missing on the server and will be installed automatically');
    }
    if (
      params.project.framework.startsWith('python') &&
      !params.server.hasPython &&
      params.server.sudoMode !== 'unavailable'
    ) {
      warnings.push('Python runtime is missing on the server and will be installed automatically');
    }

    const strategy = this.select(params.project, params.server, profile.preferredStrategy);

    return {
      profile: {
        ...profile,
        preferredStrategy: strategy.id,
      },
      projectSpec: params.project,
      serverSpec: params.server,
      strategyId: strategy.id,
      warnings,
      missingInfo,
    };
  }
}
