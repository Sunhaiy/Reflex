import path from 'path';
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
  buildCommand,
  canProvideNodeRuntime,
  installCommand,
  sanitizeAppName,
  shQuote,
  startCommand,
  withOptionalEnvFile,
  withContext,
} from './base.js';

export class NodeSystemdStrategy implements DeployStrategy {
  id = 'node-systemd' as const;

  supports(project: ProjectSpec, server: ServerSpec): boolean {
    return project.framework === 'node-service' && canProvideNodeRuntime(server) && server.hasSystemd;
  }

  async buildPlan(input: BuildPlanInput): Promise<DeployPlan> {
    const ctx = withContext(input);
    const runtimePort = ctx.profile.runtimePort || ctx.project.ports[0] || 3000;
    const install = installCommand(ctx.project.packageManager);
    const build = buildCommand(ctx.project);
    const start = startCommand(ctx.project, runtimePort);
    const envFilePath = `${ctx.sharedDir}/.env`;
    const runtimeEnvFilePath = Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined;
    const serviceFilePath = `/etc/systemd/system/${ctx.serviceName}`;
    const finalUrl = ctx.profile.domain
      ? `${ctx.profile.enableHttps ? 'https' : 'http'}://${ctx.profile.domain}${ctx.profile.healthCheckPath || ''}`
      : `http://${ctx.connectionHost}:${runtimePort}${ctx.profile.healthCheckPath || ''}`;
    const persistentSteps = ctx.project.persistentPaths.map((persistentPath, index) => {
      const sharedTarget = `${ctx.sharedDir}/persistent/${persistentPath}`;
      const releaseTarget = `${ctx.releaseDir}/${persistentPath}`;
      const releaseParent = path.posix.dirname(releaseTarget);
      return {
        kind: 'ssh_exec' as const,
        id: `persistent-${index + 1}`,
        label: `Link persistent path: ${persistentPath}`,
        command: [
          `mkdir -p ${shQuote(sharedTarget)}`,
          `mkdir -p ${shQuote(releaseParent)}`,
          `rm -rf ${shQuote(releaseTarget)}`,
          `ln -sfn ${shQuote(sharedTarget)} ${shQuote(releaseTarget)}`,
        ].join(' && '),
        sudo: true,
      };
    });
    const dependencyChecks = buildDependencyChecks(
      ctx.project.serviceDependencies,
      ctx.profile.envVars,
    ).map((item, index) => ({
      kind: 'ssh_exec' as const,
      id: `dependency-check-${index + 1}`,
      label: `Check dependency: ${item.label}`,
      command: item.command,
      cwd: ctx.releaseDir,
    }));
    const managedDependencySteps = buildManagedDependencySteps(ctx);
    const runtimeProvisionSteps = buildRuntimeProvisionSteps(ctx.server, Boolean(ctx.profile.domain));
    const packageManagerProvisionSteps = buildPackageManagerProvisionSteps(ctx.server, ctx.project.packageManager);
    const migrationSteps = buildMigrationSteps(ctx.project, runtimeEnvFilePath, ctx.releaseDir);

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
      ...persistentSteps,
      {
        kind: 'ssh_exec',
        id: 'fix-ownership',
        label: 'Fix release ownership',
        command: `chown -R ${shQuote(`${ctx.server.user}:${ctx.server.user}`)} ${shQuote(ctx.releaseDir)} ${shQuote(ctx.sharedDir)}`,
        sudo: true,
      },
      ...managedDependencySteps,
      ...dependencyChecks,
      {
        kind: 'ssh_exec',
        id: 'install',
        label: 'Install dependencies',
        command: install,
        cwd: ctx.releaseDir,
      },
      ...(build
        ? [{
            kind: 'ssh_exec' as const,
            id: 'build',
            label: 'Build application',
            command: withOptionalEnvFile(build, runtimeEnvFilePath),
            cwd: ctx.releaseDir,
          }]
        : []),
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
          description: `${ctx.profile.appName} service`,
          workingDirectory: ctx.currentDir,
          user: ctx.server.user,
          environmentFile: Object.keys(ctx.profile.envVars).length > 0 ? envFilePath : undefined,
          execStart: `/bin/bash -lc ${shQuote(start)}`,
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
      summary: `Deploy ${ctx.project.name} as Node.js systemd service`,
      releaseId: ctx.releaseId,
      steps,
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

function buildPackageManagerProvisionSteps(server: ServerSpec, packageManager?: ProjectSpec['packageManager']) {
  const ensurePackageManager = buildEnsureNodePackageManagerCommand(packageManager);
  if (!ensurePackageManager) return [] as DeployPlan['steps'];

  return [
    {
      kind: 'ssh_exec' as const,
      id: 'install-package-manager',
      label: `Install ${packageManager} package manager`,
      command: ensurePackageManager,
      sudo: server.sudoMode !== 'unavailable',
    },
  ] as DeployPlan['steps'];
}

function buildMigrationSteps(project: ProjectSpec, envFilePath: string | undefined, cwd: string) {
  return project.migrationCommands.map((command, index) => ({
    kind: 'ssh_exec' as const,
    id: `migrate-${index + 1}`,
    label: `Run migration: ${command}`,
    command: withOptionalEnvFile(command, envFilePath),
    cwd,
  })) as DeployPlan['steps'];
}

function buildManagedDependencySteps(ctx: {
  profile: { appName: string; envVars: Record<string, string> };
  project: { serviceDependencies: string[] };
  server: ServerSpec;
}) {
  const postgres = resolveLocalPostgresConfig(ctx.project.serviceDependencies, ctx.profile.envVars);
  if (!postgres) return [] as DeployPlan['steps'];

  if (ctx.server.hasDocker) {
    return buildDockerPostgresSteps(ctx.profile.appName, postgres, ctx.server);
  }

  if (ctx.server.packageManager === 'apt' && ctx.server.sudoMode !== 'unavailable') {
    return buildNativePostgresSteps(postgres);
  }

  return [] as DeployPlan['steps'];
}

function resolveLocalPostgresConfig(
  serviceDependencies: string[],
  envVars: Record<string, string>,
) {
  if (!serviceDependencies.includes('postgres') && !serviceDependencies.includes('database')) {
    return null;
  }

  const urlConfig = parseDatabaseUrl(
    envVars.DATABASE_URL || envVars.POSTGRES_URL || envVars.PGURL || envVars.POSTGRESQL_URL,
  );
  const host =
    envVars.DB_HOST || envVars.PGHOST || envVars.POSTGRES_HOST || urlConfig?.host || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    return null;
  }

  const port =
    envVars.DB_PORT || envVars.PGPORT || envVars.POSTGRES_PORT || urlConfig?.port || '5432';
  const user =
    envVars.DB_USER || envVars.PGUSER || envVars.POSTGRES_USER || urlConfig?.user || 'postgres';
  const password =
    envVars.DB_PASSWORD || envVars.PGPASSWORD || envVars.POSTGRES_PASSWORD || urlConfig?.password;
  const database =
    envVars.DB_NAME ||
    envVars.PGDATABASE ||
    envVars.POSTGRES_DB ||
    urlConfig?.database ||
    user;

  const parsedPort = Number(port);

  if (!password || !database || !Number.isFinite(parsedPort) || parsedPort <= 0) {
    return null;
  }

  return {
    host,
    port: String(parsedPort),
    user,
    password,
    database,
  };
}

function parseDatabaseUrl(rawUrl?: string) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) return null;
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || ''),
    };
  } catch {
    return null;
  }
}

function buildDockerPostgresSteps(
  appName: string,
  postgres: { port: string; user: string; password: string; database: string },
  server: ServerSpec,
) {
  const containerName = `${sanitizeAppName(appName)}-postgres`;
  const volumeName = `${sanitizeAppName(appName)}-postgres-data`;
  const useSudo = server.sudoMode !== 'unavailable';

  return [
    {
      kind: 'ssh_exec' as const,
      id: 'provision-postgres',
      label: 'Provision PostgreSQL',
      command: [
        `docker volume create ${shQuote(volumeName)} >/dev/null 2>&1 || true`,
        `if ! docker inspect ${shQuote(containerName)} >/dev/null 2>&1; then`,
        `docker run -d --name ${shQuote(containerName)} --restart unless-stopped -e POSTGRES_USER=${shQuote(postgres.user)} -e POSTGRES_PASSWORD=${shQuote(postgres.password)} -e POSTGRES_DB=${shQuote(postgres.database)} -p 127.0.0.1:${postgres.port}:5432 -v ${shQuote(volumeName)}:/var/lib/postgresql/data postgres:16`,
        'else',
        `docker start ${shQuote(containerName)} >/dev/null 2>&1 || true`,
        'fi',
      ].join(' '),
      sudo: useSudo,
    },
    {
      kind: 'ssh_exec' as const,
      id: 'wait-postgres',
      label: 'Wait for PostgreSQL readiness',
      command: [
        'for i in $(seq 1 30); do',
        `if docker exec ${shQuote(containerName)} pg_isready -U ${shQuote(postgres.user)} -d ${shQuote(postgres.database)} >/dev/null 2>&1; then exit 0; fi`,
        'sleep 2',
        'done',
        `docker logs --tail 80 ${shQuote(containerName)} || true`,
        'exit 1',
      ].join('\n'),
      sudo: useSudo,
    },
  ] as DeployPlan['steps'];
}

function buildNativePostgresSteps(postgres: {
  port: string;
  user: string;
  password: string;
  database: string;
}) {
  const roleExistsQuery = `SELECT 1 FROM pg_roles WHERE rolname = ${sqlString(postgres.user)};`;
  const databaseExistsQuery = `SELECT 1 FROM pg_database WHERE datname = ${sqlString(postgres.database)};`;
  const createRoleSql = `CREATE ROLE ${sqlIdentifier(postgres.user)} WITH LOGIN PASSWORD ${sqlString(postgres.password)};`;
  const alterRoleSql = `ALTER ROLE ${sqlIdentifier(postgres.user)} WITH LOGIN PASSWORD ${sqlString(postgres.password)};`;
  const createDatabaseSql = `CREATE DATABASE ${sqlIdentifier(postgres.database)} OWNER ${sqlIdentifier(postgres.user)};`;

  return [
    {
      kind: 'ssh_exec' as const,
      id: 'install-postgres',
      label: 'Install PostgreSQL',
      command: 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y postgresql postgresql-client',
      sudo: true,
    },
    {
      kind: 'ssh_exec' as const,
      id: 'configure-postgres',
      label: 'Configure PostgreSQL',
      command: [
        'CLUSTER_LINE="$(pg_lsclusters --no-header | awk \'NR==1 {print $1":"$2}\')"',
        'if [ -z "$CLUSTER_LINE" ]; then echo "No PostgreSQL cluster found after installation" >&2; exit 1; fi',
        'VERSION="${CLUSTER_LINE%%:*}"',
        'NAME="${CLUSTER_LINE##*:}"',
        'CONF="/etc/postgresql/$VERSION/$NAME/postgresql.conf"',
        `sed -ri "s/^#?port\\s*=.*/port = ${postgres.port}/" "$CONF"`,
        'systemctl enable postgresql',
        'systemctl restart postgresql',
        `runuser -u postgres -- psql -tAc ${shQuote(roleExistsQuery)} | grep -q 1 || runuser -u postgres -- psql -c ${shQuote(createRoleSql)}`,
        `runuser -u postgres -- psql -c ${shQuote(alterRoleSql)}`,
        `runuser -u postgres -- psql -tAc ${shQuote(databaseExistsQuery)} | grep -q 1 || runuser -u postgres -- psql -c ${shQuote(createDatabaseSql)}`,
      ].join('; '),
      sudo: true,
    },
    {
      kind: 'ssh_exec' as const,
      id: 'wait-postgres',
      label: 'Wait for PostgreSQL readiness',
      command: [
        'for i in $(seq 1 30); do',
        `if pg_isready -h 127.0.0.1 -p ${shQuote(postgres.port)} -U ${shQuote(postgres.user)} -d ${shQuote(postgres.database)} >/dev/null 2>&1; then exit 0; fi`,
        'sleep 2',
        'done',
        `pg_isready -h 127.0.0.1 -p ${shQuote(postgres.port)} -U ${shQuote(postgres.user)} -d ${shQuote(postgres.database)}`,
        'exit 1',
      ].join('\n'),
      sudo: true,
    },
  ] as DeployPlan['steps'];
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildDependencyChecks(serviceDependencies: string[], envVars: Record<string, string>) {
  const checks: { label: string; command: string }[] = [];
  const seen = new Set<string>();
  const databaseUrl = parseDatabaseUrl(
    envVars.DATABASE_URL || envVars.POSTGRES_URL || envVars.PGURL || envVars.POSTGRESQL_URL,
  );
  const nodeProbeScript = [
    'const net = require("net");',
    'const host = process.argv[1];',
    'const port = Number(process.argv[2]);',
    'if (!host || !port) process.exit(0);',
    'const socket = net.connect({ host, port });',
    'socket.setTimeout(5000);',
    'socket.on("connect", () => { console.log(`reachable ${host}:${port}`); socket.end(); });',
    'socket.on("timeout", () => { console.error(`timeout connecting to ${host}:${port}`); process.exit(1); });',
    'socket.on("error", (error) => { console.error(`connection failed to ${host}:${port}: ${error.message}`); process.exit(1); });',
  ].join(' ');
  const pushCheck = (id: string, label: string, host?: string, port?: string) => {
    if (!host || !port || seen.has(id)) return;
    seen.add(id);
    checks.push({
      label,
      command: `node -e ${shQuote(nodeProbeScript)} ${shQuote(host)} ${shQuote(port)}`,
    });
  };

  if (serviceDependencies.includes('postgres') || serviceDependencies.includes('database')) {
    pushCheck(
      'database',
      'database TCP connectivity',
      envVars.DB_HOST || envVars.PGHOST || envVars.POSTGRES_HOST || databaseUrl?.host,
      envVars.DB_PORT || envVars.PGPORT || envVars.POSTGRES_PORT || databaseUrl?.port || '5432',
    );
  }
  if (serviceDependencies.includes('mysql')) {
    pushCheck(
      'mysql',
      'MySQL TCP connectivity',
      envVars.MYSQL_HOST || envVars.DB_HOST,
      envVars.MYSQL_PORT || envVars.DB_PORT || '3306',
    );
  }
  if (serviceDependencies.includes('redis')) {
    pushCheck('redis', 'Redis TCP connectivity', envVars.REDIS_HOST, envVars.REDIS_PORT || '6379');
  }

  return checks;
}
