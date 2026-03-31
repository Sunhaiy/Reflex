import { SSHManager } from '../ssh/sshManager.js';
import { ServerSpec } from '../../src/shared/deployTypes.js';
import { shQuote } from './strategies/base.js';

function parseKeyValueOutput(raw: string): Record<string, string> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return acc;
      acc[line.slice(0, idx)] = line.slice(idx + 1);
      return acc;
    }, {});
}

export class ServerInspector {
  constructor(private sshMgr: SSHManager) {}

  async inspect(sessionId: string, fallbackHost: string): Promise<ServerSpec> {
    const script = [
      `printf 'HOST=%s\\n' ${shQuote(fallbackHost)}`,
      'printf \'USER=%s\\n\' "$(whoami 2>/dev/null || echo root)"',
      'printf \'HOME_DIR=%s\\n\' "${HOME:-~}"',
      'OS_VALUE=$(grep "^PRETTY_NAME=" /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\' || uname -s || echo Linux)',
      'printf \'OS=%s\\n\' "$OS_VALUE"',
      'printf \'ARCH=%s\\n\' "$(uname -m 2>/dev/null || echo x86_64)"',
      'if command -v apt-get >/dev/null 2>&1; then printf \'PKG_MANAGER=apt\\n\'; elif command -v dnf >/dev/null 2>&1; then printf \'PKG_MANAGER=dnf\\n\'; elif command -v yum >/dev/null 2>&1; then printf \'PKG_MANAGER=yum\\n\'; elif command -v apk >/dev/null 2>&1; then printf \'PKG_MANAGER=apk\\n\'; else printf \'PKG_MANAGER=unknown\\n\'; fi',
      'if command -v docker >/dev/null 2>&1; then printf \'HAS_DOCKER=1\\n\'; else printf \'HAS_DOCKER=0\\n\'; fi',
      'if docker compose version >/dev/null 2>&1; then printf \'DOCKER_COMPOSE_VARIANT=docker-compose-v2\\n\'; elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then printf \'DOCKER_COMPOSE_VARIANT=docker-compose-v1\\n\'; else printf \'DOCKER_COMPOSE_VARIANT=none\\n\'; fi',
      'if command -v nginx >/dev/null 2>&1; then printf \'HAS_NGINX=1\\n\'; else printf \'HAS_NGINX=0\\n\'; fi',
      'if command -v pm2 >/dev/null 2>&1; then printf \'HAS_PM2=1\\n\'; else printf \'HAS_PM2=0\\n\'; fi',
      'if command -v node >/dev/null 2>&1; then printf \'HAS_NODE=1\\n\'; else printf \'HAS_NODE=0\\n\'; fi',
      'if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then printf \'HAS_PYTHON=1\\n\'; else printf \'HAS_PYTHON=0\\n\'; fi',
      'if command -v java >/dev/null 2>&1; then printf \'HAS_JAVA=1\\n\'; else printf \'HAS_JAVA=0\\n\'; fi',
      'if command -v systemctl >/dev/null 2>&1 || [ -d /run/systemd/system ]; then printf \'HAS_SYSTEMD=1\\n\'; else printf \'HAS_SYSTEMD=0\\n\'; fi',
      'printf \'NODE_VERSION=%s\\n\' "$(node -v 2>/dev/null || echo)"',
      'PYTHON_VERSION=$(python3 --version 2>/dev/null || python --version 2>/dev/null || true); printf \'PYTHON_VERSION=%s\\n\' "$(printf "%s" "$PYTHON_VERSION" | awk \'{print $2}\')"',
      'JAVA_VERSION=$(java -version 2>&1 | awk -F[\\".] \'/version/ {print $2; exit}\' || true); printf \'JAVA_VERSION=%s\\n\' "$JAVA_VERSION"',
      'DOCKER_VERSION=$(docker --version 2>/dev/null | awk \'{print $3}\' | tr -d \',\' || true); printf \'DOCKER_VERSION=%s\\n\' "$DOCKER_VERSION"',
      'if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then printf \'SUDO_MODE=root\\n\'; elif sudo -n true >/dev/null 2>&1; then printf \'SUDO_MODE=passwordless\\n\'; else printf \'SUDO_MODE=unavailable\\n\'; fi',
      'PORTS=$( (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null || true) | awk \'NR>1{split($4,a,":"); p=a[length(a)]; if (p ~ /^[0-9]+$/) print p}\' | sort -n | uniq | paste -sd, - )',
      'printf \'OPEN_PORTS=%s\\n\' "${PORTS:-}"',
      'printf \'PUBLIC_IP=%s\\n\' "$(hostname -I 2>/dev/null | awk \'{print $1}\' || echo)"',
    ].join('\n');

    const wrapped = `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb sh -lc ${shQuote(script)}`;
    const result = await this.sshMgr.exec(sessionId, wrapped, 30000);
    const values = parseKeyValueOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
    return {
      host: values.HOST || fallbackHost,
      user: values.USER || 'root',
      homeDir: values.HOME_DIR || '~',
      os: values.OS || 'Linux',
      arch: values.ARCH || 'x86_64',
      packageManager:
        values.PKG_MANAGER === 'apt' ||
        values.PKG_MANAGER === 'dnf' ||
        values.PKG_MANAGER === 'yum' ||
        values.PKG_MANAGER === 'apk'
          ? (values.PKG_MANAGER as ServerSpec['packageManager'])
          : 'unknown',
      hasDocker: values.HAS_DOCKER === '1',
      hasDockerCompose:
        values.DOCKER_COMPOSE_VARIANT === 'docker-compose-v2' ||
        values.DOCKER_COMPOSE_VARIANT === 'docker-compose-v1',
      dockerComposeVariant:
        values.DOCKER_COMPOSE_VARIANT === 'docker-compose-v2' ||
        values.DOCKER_COMPOSE_VARIANT === 'docker-compose-v1'
          ? values.DOCKER_COMPOSE_VARIANT
          : 'none',
      hasNginx: values.HAS_NGINX === '1',
      hasPm2: values.HAS_PM2 === '1',
      hasNode: values.HAS_NODE === '1',
      hasPython: values.HAS_PYTHON === '1',
      hasSystemd: values.HAS_SYSTEMD === '1',
      sudoMode:
        values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless'
          ? (values.SUDO_MODE as ServerSpec['sudoMode'])
          : 'unavailable',
      openPorts: (values.OPEN_PORTS || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
      publicIp: values.PUBLIC_IP || undefined,
      runtimeVersions: {
        node: values.NODE_VERSION || undefined,
        python: values.PYTHON_VERSION || undefined,
        java: values.JAVA_VERSION || undefined,
        docker: values.DOCKER_VERSION || undefined,
      },
      installCapabilities: {
        canInstallPackages:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
        canInstallDocker:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
        canInstallNode:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
        canInstallPython:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
        canInstallJava:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
        canInstallNginx:
          (values.SUDO_MODE === 'root' || values.SUDO_MODE === 'passwordless') &&
          values.PKG_MANAGER !== 'unknown',
      },
    };
  }
}
