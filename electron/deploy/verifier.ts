import { SSHManager } from '../ssh/sshManager.js';
import { shQuote } from './strategies/base.js';

export class Verifier {
  constructor(private sshMgr: SSHManager) {}

  private async exec(sessionId: string, command: string, timeoutMs: number) {
    return this.sshMgr.exec(
      sessionId,
      `sh -lc ${shQuote(`export PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb; ${command}`)}`,
      timeoutMs,
    );
  }

  async verifyHttp(sessionId: string, url: string, expectedStatus = 200): Promise<string> {
    const status = await this.probeHttpStatus(sessionId, url);
    if (status !== expectedStatus) {
      throw new Error(`Expected HTTP ${expectedStatus} from ${url}, got ${status || 'no response'}`);
    }
    return `HTTP ${status} from ${url}`;
  }

  async probeHttpStatus(sessionId: string, url: string): Promise<number> {
    const command = `STATUS=$(curl -k -L -s -o /dev/null -w "%{http_code}" ${JSON.stringify(
      url,
    )}); echo "$STATUS"`;
    const result = await this.exec(sessionId, command, 20000);
    return Number(result.stdout.trim().split(/\s+/).pop() || 0);
  }

  async findHealthyUrl(
    sessionId: string,
    urls: string[],
    expectedStatus = 200,
  ): Promise<{ url: string; status: number } | null> {
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
    for (const url of uniqueUrls) {
      const status = await this.probeHttpStatus(sessionId, url);
      if (status === expectedStatus) {
        return { url, status };
      }
    }
    return null;
  }

  async verifyService(sessionId: string, serviceName: string): Promise<string> {
    const result = await this.exec(sessionId, `systemctl is-active ${JSON.stringify(serviceName)}`, 15000);
    const status = result.stdout.trim() || result.stderr.trim();
    if (status !== 'active') {
      const diagnostics = await this.exec(
        sessionId,
        [
          `echo '=== systemctl status ${serviceName} ==='`,
          `systemctl status ${JSON.stringify(serviceName)} --no-pager || true`,
          `echo`,
          `echo '=== journalctl -u ${serviceName} ==='`,
          `journalctl -u ${JSON.stringify(serviceName)} -n 80 --no-pager || true`,
        ].join('; '),
        25000,
      );
      const detail = `${diagnostics.stdout}\n${diagnostics.stderr}`.trim();
      throw new Error(
        [`Service ${serviceName} is ${status || 'unknown'}`, detail ? detail.slice(0, 6000) : '']
          .filter(Boolean)
          .join('\n\n'),
      );
    }
    return `Service ${serviceName} is active`;
  }
}
