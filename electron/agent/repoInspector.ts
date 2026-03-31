import path from 'path';
import { ProjectScanner } from '../deploy/projectScanner.js';
import { ServerInspector } from '../deploy/serverInspector.js';
import { ResolvedDeploySource, SourceResolver } from '../deploy/sourceResolver.js';
import { buildEnsureGitCommand, shQuote, toPosixPath } from '../deploy/strategies/base.js';
import { SSHManager } from '../ssh/sshManager.js';

export interface AgentRepoAnalysisResult {
  source: ResolvedDeploySource['source'];
  resolvedCheckout?: ResolvedDeploySource['resolvedCheckout'];
  projectRoot: string;
  sourceKey: string;
  projectSpec: Awaited<ReturnType<ProjectScanner['scan']>>;
  serverSpec: Awaited<ReturnType<ServerInspector['inspect']>>;
}

function buildRemoteAnalysisRoot(sourceKey: string, homeDir: string) {
  const digest = Buffer.from(sourceKey)
    .toString('base64')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 24)
    .toLowerCase();
  const baseDir = homeDir && homeDir.startsWith('/') ? homeDir : '/tmp';
  return path.posix.join(baseDir, '.zangqing', 'repos', digest);
}

export class AgentRepoInspector {
  private scanner = new ProjectScanner();
  private inspector: ServerInspector;
  private sourceResolver = new SourceResolver();

  constructor(private sshMgr: SSHManager) {
    this.inspector = new ServerInspector(sshMgr);
  }

  async analyze(
    sessionId: string,
    input: {
      projectRoot: string;
      source?: { type: 'local'; path: string } | { type: 'github'; url: string; ref?: string; subdir?: string };
    },
  ): Promise<AgentRepoAnalysisResult> {
    const resolvedSource = await this.sourceResolver.resolve(input);
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

  private async ensureRemoteGitAnalysisCheckout(
    sessionId: string,
    resolvedSource: ResolvedDeploySource,
    server: Awaited<ReturnType<ServerInspector['inspect']>>,
  ) {
    const checkout = resolvedSource.resolvedCheckout;
    if (!checkout || resolvedSource.source.type !== 'github') {
      throw new Error('Remote analysis checkout requires a GitHub source');
    }

    const analysisRoot = buildRemoteAnalysisRoot(resolvedSource.sourceKey, server.homeDir);
    const ensureGit = buildEnsureGitCommand(server);
    const fetchCommand = checkout.ref && checkout.ref !== 'HEAD'
      ? [
          `git -C ${shQuote(analysisRoot)} fetch --depth 1 origin ${shQuote(checkout.ref)}`,
          `git -C ${shQuote(analysisRoot)} checkout -f FETCH_HEAD`,
        ].join(' && ')
      : [
          `git -C ${shQuote(analysisRoot)} fetch --depth 1 origin`,
          `git -C ${shQuote(analysisRoot)} reset --hard FETCH_HEAD`,
        ].join(' && ');
    const cloneCommand = checkout.ref && checkout.ref !== 'HEAD'
      ? `git clone --depth 1 --branch ${shQuote(checkout.ref)} ${shQuote(checkout.repoUrl)} ${shQuote(analysisRoot)}`
      : `git clone --depth 1 ${shQuote(checkout.repoUrl)} ${shQuote(analysisRoot)}`;

    const script = [
      `mkdir -p ${shQuote(path.posix.dirname(analysisRoot))}`,
      ...(ensureGit ? [ensureGit] : []),
      `if [ -d ${shQuote(path.posix.join(analysisRoot, '.git'))} ]; then`,
      `  git -C ${shQuote(analysisRoot)} remote set-url origin ${shQuote(checkout.repoUrl)} || true`,
      `  ${fetchCommand}`,
      'else',
      `  rm -rf ${shQuote(analysisRoot)}`,
      `  ${cloneCommand}`,
      'fi',
      `git -C ${shQuote(analysisRoot)} rev-parse HEAD`,
    ].join('\n');

    const result = await this.sshMgr.exec(
      sessionId,
      `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb sh -lc ${shQuote(script)}`,
      240000,
    );

    const commit = result.stdout.trim().split(/\r?\n/).pop()?.trim();
    checkout.analysisRemotePath = analysisRoot;
    if (commit) {
      checkout.commit = commit;
    }

    const projectDir = resolvedSource.source.subdir
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

    return this.scanner.scanSnapshot({
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
  }
}
