import type { CpuCore, SystemStats } from '../../src/shared/types';
import { normalizeTimezone } from '../../src/shared/timezone';

/**
 * Turns one sampling batch into a SystemStats.
 *
 * Pure by design: CPU and network are rates, so they need the previous reading, and the
 * static sections only arrive on the first cycle — but all of that is passed in and
 * handed back rather than read off the manager. That is what makes the parsing testable
 * without an SSH connection, and it keeps the sampling loop free of parsing detail.
 */

export interface CpuTimes {
  total: number;
  idle: number;
}

export interface CpuSnapshot {
  total: CpuTimes;
  cores: Map<number, CpuTimes>;
}

export interface NetSnapshot {
  time: number;
  rx: number;
  tx: number;
}

/** Everything one session must remember between samples. */
export interface SampleState {
  /** Sections merge across cycles: the static ones are only sent once. */
  sections: Record<string, string>;
  cpu?: CpuSnapshot;
  net?: NetSnapshot;
}

export function emptySampleState(): SampleState {
  return { sections: {} };
}

/** Splits the `>>>SECTION` framing the sampling commands emit. */
export function parseSections(output: string, previous: Record<string, string>) {
  const sections: Record<string, string> = { ...previous };
  for (const part of output.split('>>>')) {
    const lines = part.trim().split('\n');
    const key = lines[0];
    if (!key) continue;
    sections[key] = lines.slice(1).join('\n');
  }
  return sections;
}

function parseCpuLine(line: string): CpuTimes | null {
  const parts = line.split(/\s+/);
  if (parts.length < 5) return null;
  const values = parts.slice(1).map((value) => Number.parseInt(value, 10));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    // Linux reports iowait immediately after idle. Treat both as idle time so busy
    // I/O does not appear as CPU execution.
    idle: values[3] + (values[4] || 0),
  };
}

function usageBetween(current: CpuTimes, previous?: CpuTimes) {
  if (!previous) return 0;
  const totalDiff = current.total - previous.total;
  const idleDiff = current.idle - previous.idle;
  if (totalDiff <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

const kbToGb = (kb: number) => parseFloat((kb / 1024 / 1024).toFixed(2));
const bytesToGb = (bytes: number) => parseFloat((bytes / 1024 / 1024 / 1024).toFixed(1));

function parseMemory(section: string) {
  const read = (label: string) =>
    Number.parseInt(section.match(new RegExp(`${label}:\\s+(\\d+)\\s+kB`))?.[1] ?? '0', 10);

  const total = read('MemTotal');
  const available = read('MemAvailable');
  return {
    total: kbToGb(total),
    used: kbToGb(total - available),
    free: kbToGb(available),
    cached: kbToGb(read('Cached')),
    buffers: kbToGb(read('Buffers')),
  };
}

function parseCpu(section: string, previous?: CpuSnapshot) {
  const lines = section.split('\n');
  const totalTimes = parseCpuLine(lines[0] ?? '');
  const coreTimes = new Map<number, CpuTimes>();

  const cores: CpuCore[] = lines.slice(1).map((line, index) => {
    const id = Number.parseInt(line.match(/^cpu(\d+)\s+/)?.[1] ?? '', 10);
    const coreId = Number.isFinite(id) ? id : index;
    const times = parseCpuLine(line);
    if (times) coreTimes.set(coreId, times);
    return { id: coreId, usage: times ? usageBetween(times, previous?.cores.get(coreId)) : 0 };
  });

  return {
    totalUsage: totalTimes ? usageBetween(totalTimes, previous?.total) : 0,
    cores,
    snapshot: totalTimes ? { total: totalTimes, cores: coreTimes } : previous,
  };
}

function parseNetwork(section: string, previous: NetSnapshot | undefined, now: number) {
  let rx = 0;
  let tx = 0;
  for (const line of section.split('\n')) {
    if (!line.includes(':')) continue;
    const columns = line.split(':')[1].trim().split(/\s+/);
    // /proc/net/dev: bytes is column 0 for receive and column 8 for transmit.
    if (columns.length > 1) rx += Number.parseInt(columns[0], 10) || 0;
    if (columns.length > 8) tx += Number.parseInt(columns[8], 10) || 0;
  }

  let downSpeed = 0;
  let upSpeed = 0;
  if (previous) {
    const seconds = (now - previous.time) / 1000;
    if (seconds > 0) {
      downSpeed = Math.max(0, Math.round((rx - previous.rx) / seconds));
      upSpeed = Math.max(0, Math.round((tx - previous.tx) / seconds));
    }
  }

  return { totalRx: rx, totalTx: tx, downSpeed, upSpeed, snapshot: { time: now, rx, tx } };
}

function parseDisks(section: string): SystemStats['disks'] {
  // df -B1: Filesystem 1B-blocks Used Available Use% "Mounted on"
  return section.trim().split('\n').slice(1).flatMap((line) => {
    const parts = line.split(/\s+/);
    if (parts.length < 6) return [];
    return [{
      filesystem: parts[0],
      size: bytesToGb(Number.parseInt(parts[1], 10)),
      used: bytesToGb(Number.parseInt(parts[2], 10)),
      available: bytesToGb(Number.parseInt(parts[3], 10)),
      usePercent: Number.parseInt(parts[4].replace('%', ''), 10),
      mount: parts[5],
    }];
  });
}

export interface ParseResult {
  stats: SystemStats;
  state: SampleState;
}

/** Returns null only when the batch is unusable; a missing section is not an error. */
export function parseSample(output: string, previous: SampleState, now = Date.now()): ParseResult | null {
  try {
    const sections = parseSections(output, previous.sections);

    const cpu = parseCpu(sections['CPU'] ?? '', previous.cpu);
    const network = parseNetwork(sections['NET'] ?? '', previous.net, now);
    const cpuInfo = (sections['CPU_INFO'] ?? '').split('\n');
    const speed = cpuInfo.find((line) => line.includes('cpu MHz'))?.split(':')[1]?.trim() ?? '';

    return {
      stats: {
        os: {
          distro: (sections['OS'] ?? '').match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? 'Linux',
          kernel: (sections['KERNEL'] ?? '').trim(),
          uptime: (sections['UPTIME'] ?? '').replace('up ', '').trim(),
          hostname: (sections['HOSTNAME'] ?? '').trim(),
          timezone: normalizeTimezone(sections['TZ']),
        },
        cpu: {
          totalUsage: cpu.totalUsage,
          cores: cpu.cores,
          model: cpuInfo.find((line) => line.includes('model name'))?.split(':')[1]?.trim() ?? 'Unknown CPU',
          speed: speed ? `${parseFloat(speed).toFixed(0)} MHz` : '',
        },
        memory: parseMemory(sections['MEM'] ?? ''),
        network: {
          upSpeed: network.upSpeed,
          downSpeed: network.downSpeed,
          totalTx: network.totalTx,
          totalRx: network.totalRx,
        },
        disks: parseDisks(sections['DISK'] ?? ''),
      },
      state: { sections, cpu: cpu.snapshot, net: network.snapshot },
    };
  } catch {
    return null;
  }
}
