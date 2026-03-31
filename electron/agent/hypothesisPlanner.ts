import {
  ProjectSpec,
  ServerSpec,
  DeploymentStrategyId,
} from '../../src/shared/deployTypes.js';
import {
  RepoAnalysisSummary,
  RouteHypothesis,
  RouteHypothesisKind,
} from '../../src/shared/types.js';

interface HypothesisTemplate {
  kind: RouteHypothesisKind;
  strategyId: DeploymentStrategyId;
  summary: string;
}

const HYPOTHESIS_ORDER: HypothesisTemplate[] = [
  {
    kind: 'compose-native',
    strategyId: 'docker-compose',
    summary: 'Prefer the repository-native Docker Compose route.',
  },
  {
    kind: 'dockerfile-native',
    strategyId: 'dockerfile',
    summary: 'Prefer the repository-native Dockerfile route.',
  },
  {
    kind: 'java-runtime',
    strategyId: 'java-systemd',
    summary: 'Build and run the Java service through systemd.',
  },
  {
    kind: 'python-runtime',
    strategyId: 'python-systemd',
    summary: 'Install Python dependencies and run the service through systemd.',
  },
  {
    kind: 'node-runtime',
    strategyId: 'node-systemd',
    summary: 'Install Node dependencies and run the service through systemd.',
  },
  {
    kind: 'static-nginx',
    strategyId: 'static-nginx',
    summary: 'Build static assets and serve them with nginx.',
  },
];

function capabilityLabel(server: ServerSpec, requirement: string, installed: boolean, installable: boolean) {
  if (installed) return `${requirement}:ready`;
  if (installable) return `${requirement}:installable`;
  return `${requirement}:missing`;
}

function baseScore(project: ProjectSpec, kind: RouteHypothesisKind) {
  switch (kind) {
    case 'compose-native':
      return project.framework === 'docker-compose' || project.files.includes('docker-compose.yml') || project.files.includes('compose.yml') ? 0.99 : 0;
    case 'dockerfile-native':
      return project.framework === 'dockerfile' || project.files.includes('Dockerfile') ? 0.96 : 0;
    case 'java-runtime':
      return ['java-spring-boot', 'java-service'].includes(project.framework) ? 0.92 : 0;
    case 'python-runtime':
      return ['python-fastapi', 'python-flask', 'python-service'].includes(project.framework) ? 0.9 : 0;
    case 'node-runtime':
      return ['node-service', 'nextjs'].includes(project.framework) ? 0.88 : 0;
    case 'static-nginx':
      return ['vite-static', 'react-spa'].includes(project.framework) ? 0.86 : 0;
    default:
      return 0;
  }
}

function requiredCapabilities(project: ProjectSpec, server: ServerSpec, kind: RouteHypothesisKind) {
  switch (kind) {
    case 'compose-native':
      return [
        capabilityLabel(server, 'docker', server.hasDocker, server.installCapabilities.canInstallDocker),
        capabilityLabel(
          server,
          'compose',
          server.hasDockerCompose || server.dockerComposeVariant !== 'none',
          server.installCapabilities.canInstallDocker,
        ),
      ];
    case 'dockerfile-native':
      return [
        capabilityLabel(server, 'docker', server.hasDocker, server.installCapabilities.canInstallDocker),
      ];
    case 'java-runtime':
      return [
        capabilityLabel(server, 'java', Boolean(server.runtimeVersions.java), server.installCapabilities.canInstallJava),
        capabilityLabel(server, 'systemd', server.hasSystemd, false),
        capabilityLabel(server, 'nginx', server.hasNginx, server.installCapabilities.canInstallNginx),
      ];
    case 'python-runtime':
      return [
        capabilityLabel(server, 'python', server.hasPython, server.installCapabilities.canInstallPython),
        capabilityLabel(server, 'systemd', server.hasSystemd, false),
        capabilityLabel(server, 'nginx', server.hasNginx, server.installCapabilities.canInstallNginx),
      ];
    case 'node-runtime':
      return [
        capabilityLabel(server, 'node', server.hasNode, server.installCapabilities.canInstallNode),
        capabilityLabel(server, 'systemd', server.hasSystemd, false),
        capabilityLabel(server, 'nginx', server.hasNginx, server.installCapabilities.canInstallNginx),
      ];
    case 'static-nginx':
      return [
        capabilityLabel(server, 'node', server.hasNode, server.installCapabilities.canInstallNode),
        capabilityLabel(server, 'nginx', server.hasNginx, server.installCapabilities.canInstallNginx),
      ];
    default:
      return [];
  }
}

function disproofSignals(kind: RouteHypothesisKind) {
  switch (kind) {
    case 'compose-native':
      return ['compose file invalid', 'services fail after compose boot', 'compose route verified false'];
    case 'dockerfile-native':
      return ['docker image cannot boot app', 'docker route verified false'];
    case 'java-runtime':
      return ['java artifacts missing', 'jar cannot be produced', 'java service route verified false'];
    case 'python-runtime':
      return ['python entrypoint missing', 'venv install irrecoverable', 'python service route verified false'];
    case 'node-runtime':
      return ['node entrypoint missing', 'package install irrecoverable', 'node service route verified false'];
    case 'static-nginx':
      return ['no static build output', 'nginx static route verified false'];
    default:
      return [];
  }
}

function evidenceFor(project: ProjectSpec, analysis: RepoAnalysisSummary, kind: RouteHypothesisKind) {
  const evidence = new Set<string>();
  if (analysis.readmeSummary) evidence.add(`README: ${analysis.readmeSummary}`);
  for (const item of project.evidence.slice(0, 4)) evidence.add(item);
  for (const item of analysis.deploymentHints.slice(0, 4)) evidence.add(item);

  switch (kind) {
    case 'compose-native':
      if (project.files.includes('docker-compose.yml')) evidence.add('Found docker-compose.yml');
      if (project.files.includes('compose.yml')) evidence.add('Found compose.yml');
      break;
    case 'dockerfile-native':
      if (project.files.includes('Dockerfile')) evidence.add('Found Dockerfile');
      break;
    case 'java-runtime':
      if (analysis.runtimeRequirements.some((item) => item.name === 'java')) evidence.add('Java runtime required');
      break;
    case 'python-runtime':
      if (analysis.runtimeRequirements.some((item) => item.name === 'python')) evidence.add('Python runtime required');
      break;
    case 'node-runtime':
      if (analysis.runtimeRequirements.some((item) => item.name === 'node')) evidence.add('Node runtime required');
      break;
    case 'static-nginx':
      if (analysis.buildCommands.length > 0) evidence.add(`Build command: ${analysis.buildCommands[0]}`);
      if (project.outputDir) evidence.add(`Output dir: ${project.outputDir}`);
      break;
  }

  return Array.from(evidence).slice(0, 6);
}

function buildFallbackKinds(project: ProjectSpec, analysis: RepoAnalysisSummary): RouteHypothesisKind[] {
  const kinds: RouteHypothesisKind[] = [];
  const fileSet = new Set(project.files);
  const runtimeNames = new Set(analysis.runtimeRequirements.map((item) => item.name));

  if (fileSet.has('docker-compose.yml') || fileSet.has('compose.yml')) {
    kinds.push('compose-native');
  }
  if (fileSet.has('Dockerfile')) {
    kinds.push('dockerfile-native');
  }
  if (runtimeNames.has('java') || project.framework === 'java-service' || project.framework === 'java-spring-boot') {
    kinds.push('java-runtime');
  }
  if (runtimeNames.has('python') || project.framework.startsWith('python')) {
    kinds.push('python-runtime');
  }
  if (project.outputDir || /static/i.test(project.packaging) || analysis.buildCommands.some((item) => /vite|build/i.test(item))) {
    kinds.push('static-nginx');
  }
  if (runtimeNames.has('node') || Boolean(project.packageJson) || project.startCommands.length > 0 || project.buildCommands.length > 0) {
    kinds.push('node-runtime');
  }

  return Array.from(new Set(kinds));
}

export class HypothesisPlanner {
  build(project: ProjectSpec, server: ServerSpec, analysis: RepoAnalysisSummary): RouteHypothesis[] {
    const hypotheses: RouteHypothesis[] = [];
    for (const template of HYPOTHESIS_ORDER) {
      const score = baseScore(project, template.kind);
      if (score <= 0) continue;
      hypotheses.push({
        id: `route-${template.kind}`,
        kind: template.kind,
        score,
        summary: template.summary,
        strategyId: template.strategyId,
        evidence: evidenceFor(project, analysis, template.kind),
        requiredCapabilities: requiredCapabilities(project, server, template.kind),
        disproofSignals: disproofSignals(template.kind),
      });
    }
    hypotheses.sort((a, b) => b.score - a.score);

    if (hypotheses.length > 0) {
      return hypotheses.slice(0, 3);
    }

    const fallbackKinds = buildFallbackKinds(project, analysis);
    if (fallbackKinds.length === 0) {
      return [];
    }

    return fallbackKinds.slice(0, 3).map((kind, index) => {
      const template = HYPOTHESIS_ORDER.find((item) => item.kind === kind)!;
      return {
        id: `route-${kind}`,
        kind,
        score: 0.3 - index * 0.02,
        summary: template.summary,
        strategyId: template.strategyId,
        evidence: [
          'Repository shape is still partially ambiguous',
          ...evidenceFor(project, analysis, kind).slice(0, 3),
        ],
        requiredCapabilities: requiredCapabilities(project, server, kind),
        disproofSignals: disproofSignals(kind),
      };
    });
  }
}
