import { SSHManager } from '../ssh/sshManager.js';
import { ServerSpec } from '../../src/shared/deployTypes.js';

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
    const command = [
      'echo HOST=' + fallbackHost,
      'echo USER=$(whoami)',
      'echo HOME_DIR=$HOME',
      'echo OS=$(grep "^PRETTY_NAME=" /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\' || uname -s)',
      'echo ARCH=$(uname -m)',
      'if command -v apt-get >/dev/null 2>&1; then echo PKG_MANAGER=apt; elif command -v dnf >/dev/null 2>&1; then echo PKG_MANAGER=dnf; elif command -v yum >/dev/null 2>&1; then echo PKG_MANAGER=yum; elif command -v apk >/dev/null 2>&1; then echo PKG_MANAGER=apk; else echo PKG_MANAGER=unknown; fi',
      'command -v docker >/dev/null 2>&1 && echo HAS_DOCKER=1 || echo HAS_DOCKER=0',
      'if docker compose version >/dev/null 2>&1; then echo DOCKER_COMPOSE_VARIANT=docker-compose-v2; elif docker-compose version >/dev/null 2>&1; then echo DOCKER_COMPOSE_VARIANT=docker-compose-v1; else echo DOCKER_COMPOSE_VARIANT=none; fi',
      'command -v nginx >/dev/null 2>&1 && echo HAS_NGINX=1 || echo HAS_NGINX=0',
      'command -v pm2 >/dev/null 2>&1 && echo HAS_PM2=1 || echo HAS_PM2=0',
      'command -v node >/dev/null 2>&1 && echo HAS_NODE=1 || echo HAS_NODE=0',
      '(command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1) && echo HAS_PYTHON=1 || echo HAS_PYTHON=0',
      'command -v java >/dev/null 2>&1 && echo HAS_JAVA=1 || echo HAS_JAVA=0',
      'command -v systemctl >/dev/null 2>&1 && echo HAS_SYSTEMD=1 || echo HAS_SYSTEMD=0',
      'echo NODE_VERSION=$(node -v 2>/dev/null || echo)',
      'PYTHON_VERSION=$(python3 --version 2>/dev/null || python --version 2>/dev/null || true); echo PYTHON_VERSION=$(printf "%s" "$PYTHON_VERSION" | awk \'{print $2}\')',
      'JAVA_VERSION=$(java -version 2>&1 | awk -F[\".] \'/version/ {print $2; exit}\' || true); echo JAVA_VERSION=$JAVA_VERSION',
      'DOCKER_VERSION=$(docker --version 2>/dev/null | awk \'{print $3}\' | tr -d \',\' || true); echo DOCKER_VERSION=$DOCKER_VERSION',
      'if [ "$(id -u)" = "0" ]; then echo SUDO_MODE=root; elif sudo -n true >/dev/null 2>&1; then echo SUDO_MODE=passwordless; else echo SUDO_MODE=unavailable; fi',
      'PORTS=$( (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null || true) | awk \'NR>1{split($4,a,":"); p=a[length(a)]; if (p ~ /^[0-9]+$/) print p}\' | sort -n | uniq | paste -sd, - )',
      'echo OPEN_PORTS=${PORTS:-}',
      'echo PUBLIC_IP=$(hostname -I 2>/dev/null | awk \'{print $1}\')',
    ].join(' ; ');

    const result = await this.sshMgr.exec(sessionId, command, 15000);
    const values = parseKeyValueOutput(result.stdout);
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
