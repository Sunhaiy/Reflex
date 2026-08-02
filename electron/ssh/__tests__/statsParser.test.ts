import { describe, expect, it } from 'vitest';
import { emptySampleState, parseSample, parseSections } from '../statsParser';

// Shaped exactly like what the sampling commands emit over the channel.
const FIRST_BATCH = [
  '>>>OS',
  'PRETTY_NAME="Ubuntu 24.04 LTS"',
  'ID=ubuntu',
  '>>>TZ',
  'Asia/Shanghai',
  '>>>KERNEL',
  '6.8.0-45-generic',
  '>>>HOSTNAME',
  'web-01',
  '>>>CPU_INFO',
  'model name\t: AMD EPYC 7763',
  'cpu MHz\t\t: 2445.406',
  '>>>CPU',
  'cpu  100 0 50 800 20 0 0 0 0 0',
  'cpu0 50 0 25 400 10 0 0 0 0 0',
  'cpu1 50 0 25 400 10 0 0 0 0 0',
  '>>>MEM',
  'MemTotal:        4194304 kB',
  'MemAvailable:    3145728 kB',
  'Cached:           524288 kB',
  'Buffers:          104857 kB',
  '>>>NET',
  'Inter-|   Receive',
  '  eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0',
  '>>>UPTIME',
  'up 3 weeks, 2 days',
].join('\n');

describe('parseSections', () => {
  it('carries earlier sections forward, since static ones arrive once', () => {
    const first = parseSections('>>>OS\nPRETTY_NAME="Debian"', {});
    const second = parseSections('>>>CPU\ncpu 1 2 3 4', first);
    expect(second['OS']).toContain('Debian');
    expect(second['CPU']).toBe('cpu 1 2 3 4');
  });

  it('lets a later batch replace a section it resends', () => {
    const first = parseSections('>>>UPTIME\nup 1 hour', {});
    expect(parseSections('>>>UPTIME\nup 2 hours', first)['UPTIME']).toBe('up 2 hours');
  });
});

describe('parseSample', () => {
  it('reads the static facts off the first batch', () => {
    const result = parseSample(FIRST_BATCH, emptySampleState())!;
    expect(result.stats.os.distro).toBe('Ubuntu 24.04 LTS');
    expect(result.stats.os.timezone).toBe('Asia/Shanghai');
    // Both used to be hardcoded strings rather than anything the server said.
    expect(result.stats.os.kernel).toBe('6.8.0-45-generic');
    expect(result.stats.os.hostname).toBe('web-01');
    expect(result.stats.cpu.model).toBe('AMD EPYC 7763');
    expect(result.stats.cpu.speed).toBe('2445 MHz');
    expect(result.stats.os.uptime).toBe('3 weeks, 2 days');
  });

  it('converts memory from kB to GB', () => {
    const { stats } = parseSample(FIRST_BATCH, emptySampleState())!;
    expect(stats.memory.total).toBe(4);
    expect(stats.memory.free).toBe(3);
    expect(stats.memory.used).toBe(1);
  });

  it('reports zero CPU on the first sample, since a rate needs two', () => {
    const { stats } = parseSample(FIRST_BATCH, emptySampleState())!;
    expect(stats.cpu.totalUsage).toBe(0);
    expect(stats.cpu.cores).toHaveLength(2);
  });

  it('computes CPU usage from the delta between two samples', () => {
    // 1000 ticks with 800 idle, then 1100 with 825: 100 elapsed, 25 of them idle,
    // so the CPU was executing for 75 of them.
    const first = parseSample('>>>CPU\ncpu 100 0 100 800 0 0 0 0 0 0', emptySampleState())!;
    const second = parseSample('>>>CPU\ncpu 150 0 125 825 0 0 0 0 0 0', first.state)!;
    expect(second.stats.cpu.totalUsage).toBe(75);
  });

  it('treats iowait as idle rather than as execution', () => {
    const first = parseSample('>>>CPU\ncpu 0 0 0 0 0 0 0 0 0 0', emptySampleState())!;
    // Entire delta lands in iowait, so the CPU was not executing anything.
    const second = parseSample('>>>CPU\ncpu 0 0 0 0 100 0 0 0 0 0', first.state)!;
    expect(second.stats.cpu.totalUsage).toBe(0);
  });

  it('derives network speed from the byte counters over elapsed time', () => {
    const base = Date.parse('2026-08-01T00:00:00Z');
    const first = parseSample(FIRST_BATCH, emptySampleState(), base)!;
    const second = parseSample(
      '>>>NET\n  eth0: 3000 0 0 0 0 0 0 0 6000 0 0 0 0 0 0 0',
      first.state,
      base + 2000,
    )!;
    expect(second.stats.network.downSpeed).toBe(1000);
    expect(second.stats.network.upSpeed).toBe(2000);
  });

  it('never reports a negative rate when counters reset', () => {
    const base = Date.parse('2026-08-01T00:00:00Z');
    const first = parseSample(FIRST_BATCH, emptySampleState(), base)!;
    const second = parseSample('>>>NET\n  eth0: 5 0 0 0 0 0 0 0 5 0 0 0 0 0 0 0', first.state, base + 1000)!;
    expect(second.stats.network.downSpeed).toBe(0);
    expect(second.stats.network.upSpeed).toBe(0);
  });

  it('leaves disks empty until df arrives, rather than failing', () => {
    const { stats } = parseSample(FIRST_BATCH, emptySampleState())!;
    expect(stats.disks).toEqual([]);
  });

  it('parses df output once it does', () => {
    const withDisks = parseSample(
      ['>>>DISK',
        'Filesystem     1B-blocks       Used  Available Use% Mounted on',
        '/dev/vda1    42949672960 8589934592 34359738368  20% /',
      ].join('\n'),
      emptySampleState(),
    )!;
    expect(withDisks.stats.disks).toEqual([{
      filesystem: '/dev/vda1',
      size: 40,
      used: 8,
      available: 32,
      usePercent: 20,
      mount: '/',
    }]);
  });

  it('skips malformed df rows instead of emitting broken entries', () => {
    const result = parseSample('>>>DISK\nheader\ngarbage row\n', emptySampleState())!;
    expect(result.stats.disks).toEqual([]);
  });

  it('falls back to safe defaults when a batch is empty', () => {
    const { stats } = parseSample('', emptySampleState())!;
    expect(stats.os.distro).toBe('Linux');
    expect(stats.cpu.model).toBe('Unknown CPU');
    expect(stats.memory.total).toBe(0);
  });
});
