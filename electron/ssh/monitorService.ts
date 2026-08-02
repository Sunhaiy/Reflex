import type { Client, ClientChannel } from 'ssh2';
import type { WebContents } from 'electron';
import type { ActivityLevel, ActivityScope } from '../../src/shared/types';
import { emptySampleState, parseSample, type SampleState } from './statsParser';

/** What sampling needs from the session manager, and nothing more. */
export interface MonitorHost {
  getConnection(id: string): Client | undefined;
  emitActivity(
    sessionId: string,
    text: string,
    level?: ActivityLevel,
    webContents?: WebContents,
    scope?: ActivityScope,
  ): void;
}

/**
 * Samples a session on an interval over one long-lived shell channel.
 *
 * Opening a fresh channel per sample cost an extra round trip every three seconds,
 * which dominates on a high-latency link, so the channel is kept and each batch is
 * framed by a sentinel echo. Parsing lives in statsParser; this file is only about
 * getting bytes off the wire on a schedule.
 */
export class MonitorService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private sampleStates: Map<string, SampleState> = new Map();
  private tokens: Map<string, number> = new Map();
  private channels: Map<string, ClientChannel> = new Map();
  private buffers: Map<string, string> = new Map();
  private waiters: Map<string, {
    sentinel: string;
    resolve: (output: string) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private nextToken = 0;
  private nextSeq = 0;

  constructor(private host: MonitorHost) { }

  /** Called when a session goes away for any reason. */
  dispose(id: string) {
    this.stopMonitoring(id);
    this.sampleStates.delete(id);
  }

  private closeChannel(id: string, error?: Error) {
      const waiter = this.waiters.get(id);
      if (waiter) {
      this.waiters.delete(id);
      waiter.reject(error || new Error('Monitor channel closed'));
      }
      this.buffers.delete(id);

      const channel = this.channels.get(id);
      if (!channel) return;
      this.channels.delete(id);
      try {
      channel.removeAllListeners();
      channel.on('error', () => { }); // swallow anything raised during teardown
      channel.destroy();
      } catch { /* the channel is being discarded; failures here change nothing */ }
  }

  private openChannel(id: string): Promise<ClientChannel> {
      const existing = this.channels.get(id);
      if (existing) return Promise.resolve(existing);

      const conn = this.host.getConnection(id);
      if (!conn) return Promise.reject(new Error('Not connected'));

      return new Promise((resolve, reject) => {
      // A bare `sh` with no PTY: nothing echoes what we write and there is no
      // prompt, so the channel carries only the output we asked for.
      conn.exec('/bin/sh', (error, channel) => {
          if (error) return reject(error);
          this.channels.set(id, channel);
          this.buffers.set(id, '');
          channel.on('data', (chunk: Buffer) => this.onData(id, chunk.toString()));
          channel.stderr.on('data', () => { /* command noise is not part of a sample */ });
          channel.on('close', () => this.closeChannel(id, new Error('Monitor channel closed')));
          channel.on('error', (channelError: Error) => this.closeChannel(id, channelError));
          resolve(channel);
      });
      });
  }

  private onData(id: string, chunk: string) {
      const buffer = (this.buffers.get(id) || '') + chunk;
      const waiter = this.waiters.get(id);
      if (!waiter) {
      this.buffers.set(id, buffer);
      return;
      }

      const marker = buffer.indexOf(waiter.sentinel);
      if (marker === -1) {
      this.buffers.set(id, buffer);
      return;
      }

      this.waiters.delete(id);
      this.buffers.set(id, '');
      waiter.resolve(buffer.slice(0, marker));
  }

  /**
   * Runs one batch on the session's long-lived shell channel. Opening a fresh channel
   * per sample cost an extra round trip every three seconds, which dominates the cost
   * on a high-latency link. The trailing sentinel echo is what frames one sample's
   * output from the next.
   */
  private async runBatch(id: string, command: string, timeoutMs: number): Promise<string> {
      const channel = await this.openChannel(id);
      const sentinel = `__RFX_SAMPLE_${++this.nextSeq}__`;

      return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
          // A half-read frame would corrupt the next sample, so the channel goes
          // with it rather than being reused in an unknown state.
          this.closeChannel(id, new Error(`Collection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.set(id, {
          sentinel,
          resolve: (output) => { clearTimeout(timer); resolve(output); },
          reject: (error) => { clearTimeout(timer); reject(error); },
      });

      try {
          channel.write(`${command}\necho "${sentinel}"\n`);
      } catch (error: any) {
          this.closeChannel(id, error instanceof Error ? error : new Error(String(error)));
      }
      });
  }

  startMonitoring(id: string, webContents: WebContents) {
      if (this.intervals.has(id)) return;

      this.sampleStates.delete(id);

      const monitorToken = ++this.nextToken;
      this.tokens.set(id, monitorToken);

      const staticCommand = `
  echo ">>>OS"; cat /etc/os-release;
  echo ">>>TZ"; (cat /etc/timezone 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##' || timedatectl show -p Timezone --value 2>/dev/null) | head -1;
  echo ">>>KERNEL"; uname -r;
  echo ">>>HOSTNAME"; hostname;
  echo ">>>CPU_INFO"; grep -m 1 "model name" /proc/cpuinfo; grep -m 1 "cpu MHz" /proc/cpuinfo;
  `;
      const dynamicCommand = `
  echo ">>>CPU"; grep '^cpu' /proc/stat;
  echo ">>>MEM"; grep -E '^(MemTotal|MemAvailable|Cached|Buffers):' /proc/meminfo;
  echo ">>>NET"; cat /proc/net/dev;
  echo ">>>UPTIME"; uptime -p;
  `;
      // df walks every mount and is by far the slowest part of a cycle on a busy or
      // high-latency host. Everything above reads /proc and returns immediately, so
      // the panel can paint without waiting on this one.
      const slowCommand = `
  echo ">>>DISK"; df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs;
  `;

      let pending = false; // prevent overlapping execs when network is slow
      let cycle = 0;

      const collect = () => {
      if (this.tokens.get(id) !== monitorToken) return;
      const conn = this.host.getConnection(id);
      if (!conn) return this.stopMonitoring(id);
      if (pending) return; // skip this tick if the previous one is still running
      pending = true;

      const includeStatic = cycle === 0;
      // Never on the first cycle: disks ride the 700ms primer instead, so the first
      // reading reaches the panel a whole df sooner.
      const includeSlow = cycle === 1 || (cycle > 0 && cycle % 5 === 0);
      const firstCycle = cycle === 0;
      cycle += 1;
      const cmd = `${includeStatic ? staticCommand : ''}${dynamicCommand}${includeSlow ? slowCommand : ''}`;

      if (firstCycle) {
          this.host.emitActivity(id, 'Reading /etc/os-release, /proc/cpuinfo, uname, hostname...', 'info', webContents, 'monitor');
          this.host.emitActivity(id, 'Reading /proc/stat, /proc/meminfo, /proc/net/dev, uptime...', 'info', webContents, 'monitor');
      }

      this.runBatch(id, cmd, 5000).then((output) => {
          pending = false;
          if (this.tokens.get(id) !== monitorToken) return;
          if (webContents.isDestroyed()) {
              this.stopMonitoring(id);
              return;
          }

          const parsed = parseSample(output, this.sampleStates.get(id) ?? emptySampleState());
          if (parsed) this.sampleStates.set(id, parsed.state);
          const stats = parsed?.stats;
          if (!stats) {
              if (firstCycle) {
                  this.host.emitActivity(id, 'Sample received but could not be parsed.', 'error', webContents, 'monitor');
              }
              return;
          }

          if (firstCycle) {
              this.host.emitActivity(id, `Detected ${stats.os.distro}, ${stats.cpu.cores.length} cores.`, 'ok', webContents, 'monitor');
          }
          webContents.send('stats-update', { id, stats });

          // CPU and network are deltas between two readings, so the first sample
          // can only report zero. Take a second one right away rather than leaving
          // the panel empty for a whole interval. A primer that fires after
          // stopMonitoring is harmless: the token check at the top discards it.
          if (firstCycle) setTimeout(collect, 700);
      }).catch((error: Error) => {
          pending = false;
          if (this.tokens.get(id) !== monitorToken) return;
          this.host.emitActivity(id, `Sample failed: ${error.message}`, 'error', webContents, 'monitor');
      });
      };

      const interval = setInterval(collect, 3000);
      this.intervals.set(id, interval);
      collect();
  }

  stopMonitoring(id: string) {
      this.closeChannel(id);
      this.tokens.delete(id);
      const interval = this.intervals.get(id);
      if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
      }
      this.sampleStates.delete(id);
  }
}
