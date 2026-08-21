import type { Client } from 'ssh2';
import type { DockerContainer, DockerImage, RemoteProcess } from '../../src/shared/types';

/** Host inspection that is just a shell command and a parse: processes and Docker. */
export interface CommandHost {
  execCommand(id: string, command: string, maxOutputBytes?: number): Promise<{ stdout: string; stderr: string }>;
  getConnection(id: string): Client | undefined;
}

/**
 * Identifiers reaching a shell command are checked rather than escaped. Docker ids and
 * names are alphanumeric by construction, so anything else is a caller bug or an
 * injection attempt; refusing outright is both simpler and safer than quoting.
 */
function assertSafeIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

export class CommandService {
  constructor(private host: CommandHost) { }

  async isDockerAvailable(id: string): Promise<boolean> {
      const { stdout } = await this.host.execCommand(
      id,
      'if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; '
        + 'then printf available; else printf unavailable; fi',
      );
      return stdout.trim() === 'available';
  }

  async getProcesses(id: string): Promise<RemoteProcess[]> {
      const { stdout } = await this.host.execCommand(
      id,
      'ps -ax -o pid,user,%cpu,%mem,comm,args',
      2 * 1024 * 1024,
      );
      const lines = stdout.trim().split('\n');
      return lines.slice(1).map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;
      const pid = Number.parseInt(parts[0], 10);
      const cpu = Number.parseFloat(parts[2]);
      const mem = Number.parseFloat(parts[3]);
      if (!Number.isSafeInteger(pid) || !Number.isFinite(cpu) || !Number.isFinite(mem)) return null;
      return {
          pid,
          user: parts[1],
          cpu,
          mem,
          command: parts[4],
          args: parts.slice(5).join(' '),
      };
      }).filter((process) => process !== null);
  }

  async killProcess(id: string, pid: number): Promise<void> {
      const conn = this.host.getConnection(id);
      if (!conn) throw new Error('Not connected');
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');

      return new Promise((resolve, reject) => {
      conn.exec(`kill -9 ${pid}`, (err, stream) => {
          if (err) return reject(err);
          stream.on('close', (code: number | null) => {
              if (code === 0) resolve();
              else reject(new Error(`Process exited with code ${code}`));
          });
      });
      });
  }

  async getDockerContainers(id: string): Promise<DockerContainer[]> {
      const command = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.Label \\"com.docker.compose.project\\"}}"';
      const { stdout } = await this.host.execCommand(id, command, 2 * 1024 * 1024);
      return stdout.trim().split('\n').filter((line) => line.trim()).map((line) => {
      const parts = line.split('|');
      return {
          id: parts[0] || '',
          name: parts[1] || '',
          image: parts[2] || '',
          status: parts[3] || '',
          state: parts[4] || '',
          ports: parts[5] || '',
          composeProject: parts[6] || '',
      };
      });
  }

  async dockerAction(id: string, containerId: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove'): Promise<void> {
      assertSafeIdentifier(containerId, 'container ID');
      const allowedActions = new Set(['start', 'stop', 'restart', 'pause', 'unpause', 'remove']);
      if (!allowedActions.has(action)) throw new Error('Invalid Docker action');

      const cmd = action === 'remove' ? `docker rm -f ${containerId}` : `docker ${action} ${containerId}`;
      await this.host.execCommand(id, cmd);
  }

  async dockerLogs(id: string, containerId: string, lines: number = 200): Promise<string> {
      assertSafeIdentifier(containerId, 'container ID');
      const safeLines = Math.min(10_000, Math.max(1, Math.trunc(lines)));
      const { stdout, stderr } = await this.host.execCommand(
      id,
      `docker logs --tail ${safeLines} ${containerId}`,
      );
      return `${stdout}${stderr}`;
  }

  async dockerImages(id: string): Promise<DockerImage[]> {
      const { stdout } = await this.host.execCommand(
      id,
      'docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}"',
      2 * 1024 * 1024,
      );
      return stdout.trim().split('\n').filter((line) => line.trim()).map((line) => {
      const [imageId, repository, tag, size, created] = line.split('|');
      return { id: imageId, repository, tag, size, created };
      });
  }

  async dockerRemoveImage(id: string, imageId: string): Promise<string> {
      assertSafeIdentifier(imageId, 'image ID');
      const { stdout, stderr } = await this.host.execCommand(id, `docker rmi ${imageId}`);
      return `${stdout}${stderr}`;
  }

  async dockerPrune(id: string, type: 'system' | 'images' | 'volumes' | 'containers'): Promise<string> {
      const cmds: Record<string, string> = {
      system: 'docker system prune -af --volumes',
      images: 'docker image prune -af',
      volumes: 'docker volume prune -af',
      containers: 'docker container prune -f',
      };
      const command = cmds[type];
      if (!command) throw new Error('Invalid Docker prune type');
      const { stdout, stderr } = await this.host.execCommand(id, command);
      return `${stdout}${stderr}`;
  }

  async dockerDiskUsage(id: string): Promise<string> {
      const { stdout, stderr } = await this.host.execCommand(id, 'docker system df');
      return `${stdout}${stderr}`;
  }
}
