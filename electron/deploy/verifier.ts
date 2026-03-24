import { SSHManager } from '../ssh/sshManager.js';

export class Verifier {
  constructor(private sshMgr: SSHManager) {}

  async verifyHttp(sessionId: string, url: string, expectedStatus = 200): Promise<string> {
    const command = `STATUS=$(curl -k -L -s -o /dev/null -w "%{http_code}" ${JSON.stringify(
      url,
    )}); echo "$STATUS"`;
    const result = await this.sshMgr.exec(sessionId, command, 20000);
    const status = Number(result.stdout.trim().split(/\s+/).pop() || 0);
    if (status !== expectedStatus) {
      throw new Error(`Expected HTTP ${expectedStatus} from ${url}, got ${status || 'no response'}`);
    }
    return `HTTP ${status} from ${url}`;
  }

  async verifyService(sessionId: string, serviceName: string): Promise<string> {
    const result = await this.sshMgr.exec(
      sessionId,
      `systemctl is-active ${JSON.stringify(serviceName)}`,
      15000,
    );
    const status = result.stdout.trim();
    if (status !== 'active') {
      throw new Error(`Service ${serviceName} is ${status || 'unknown'}`);
    }
    return `Service ${serviceName} is active`;
  }
}

