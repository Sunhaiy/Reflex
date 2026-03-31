import { ProjectSpec, ServerSpec } from '../../src/shared/deployTypes.js';
import { RepoAnalysisSummary, TaskSourceType } from '../../src/shared/types.js';

export function buildRepoAnalysis(
  draft: { projectSpec: ProjectSpec; source?: { type: TaskSourceType | string; url?: string } },
): RepoAnalysisSummary {
  const project = draft.projectSpec;
  const sourceLabel = draft.source?.type === 'github'
    ? (draft.source.url || project.rootPath)
    : project.rootPath;
  return {
    sourceType: draft.source?.type === 'github' ? 'github' : 'local',
    sourceLabel,
    repoName: project.name,
    framework: project.framework,
    language: project.language,
    packaging: project.packaging,
    runtimeRequirements: project.runtimeRequirements.map((item) => ({
      name: item.name,
      version: item.version,
    })),
    serviceDependencies: project.serviceDependencies,
    buildCommands: project.buildCommands,
    startCommands: project.startCommands,
    healthCheckCandidates: project.healthCheckCandidates,
    deploymentHints: project.deploymentHints,
    readmeSummary: project.readmeSummary,
    confidence: project.confidence,
  };
}

export function summarizeKnownFacts(project: ProjectSpec, server: ServerSpec) {
  const facts = [
    `Project framework: ${project.framework}`,
    `Project language: ${project.language}`,
    `Packaging: ${project.packaging}`,
    `Server OS: ${server.os}`,
    `Server package manager: ${server.packageManager}`,
    `Docker: ${server.hasDocker ? 'installed' : 'missing'}`,
    `Compose: ${server.dockerComposeVariant}`,
    `Node: ${server.runtimeVersions.node || (server.hasNode ? 'installed' : 'missing')}`,
    `Python: ${server.runtimeVersions.python || (server.hasPython ? 'installed' : 'missing')}`,
    `Java: ${server.runtimeVersions.java || 'missing'}`,
  ];
  if (project.readmeSummary) facts.push(`README summary: ${project.readmeSummary}`);
  if (project.serviceDependencies.length) facts.push(`Dependencies: ${project.serviceDependencies.join(', ')}`);
  if (project.healthCheckCandidates.length) facts.push(`Health paths: ${project.healthCheckCandidates.slice(0, 4).join(', ')}`);
  return facts;
}

export function sourceTypeOf(input?: { type?: TaskSourceType | string }): TaskSourceType {
  return input?.type === 'github' ? 'github' : 'local';
}
