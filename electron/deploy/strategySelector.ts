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
    const baseAppName = sanitizeAppName(
      params.input.appName || params.existingProfile?.appName || params.project.name,
    );
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
        params.project.ports[0] ??
        (params.project.framework.startsWith('python') ? 8000 : 3000),
      envVars: params.input.envVars ?? params.existingProfile?.envVars ?? {},
      installMissingDependencies:
        params.input.installMissingDependencies ??
        params.existingProfile?.installMissingDependencies ??
        true,
      enableHttps: params.input.enableHttps ?? params.existingProfile?.enableHttps ?? false,
      healthCheckPath:
        params.input.healthCheckPath ?? params.existingProfile?.healthCheckPath ?? '/',
    };

    const warnings: string[] = [];
    const missingInfo: string[] = [];

    if (params.project.framework === 'unknown') {
      missingInfo.push('Project type could not be identified automatically');
    }
    if (profile.enableHttps && !profile.domain) {
      missingInfo.push('A domain is required to configure HTTPS');
    }
    if (params.project.envFiles.includes('.env.example') && Object.keys(profile.envVars).length === 0) {
      warnings.push('Project has .env.example but no deploy env vars were provided');
    }
    if (!profile.domain) {
      warnings.push('No domain set. Final URL will use the SSH host and port');
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
