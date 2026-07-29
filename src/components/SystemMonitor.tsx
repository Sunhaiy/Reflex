import { HugeiconsIcon } from '@hugeicons/react';
import { AiNetworkIcon, CpuIcon, HardDriveIcon, RamMemoryIcon, TerminalIcon } from '@hugeicons/core-free-icons';
import { useEffect, useId, useState } from 'react';
import type { SystemStats } from '../shared/types';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';
import { ProcessList } from './ProcessList';
import { ConnectingLog } from './ConnectingOverlay';

interface SystemMonitorProps {
  connectionId: string;
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function SystemMonitor({ connectionId }: SystemMonitorProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [showProcesses, setShowProcesses] = useState(false);
  const [netHistory, setNetHistory] = useState<{ time: number; up: number; down: number }[]>([]);
  const networkGradientId = `network-gradient-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    setStats(null);
    setNetHistory([]);
    setShowProcesses(false);
    window.electron.startMonitoring(connectionId);

    const cleanup = window.electron.onStatsUpdate((_, { id, stats: nextStats }) => {
      if (id === connectionId) {
        setStats(nextStats);
        setNetHistory((previous) => {
          const next = [...previous, {
            time: Date.now(),
            up: nextStats.network.upSpeed / 1024,
            down: nextStats.network.downSpeed / 1024,
          }];
          return next.slice(-40);
        });
      }
    });

    return () => {
      cleanup();
      window.electron.stopMonitoring(connectionId);
    };
  }, [connectionId]);

  if (!stats) {
    return (
      <div className="h-full overflow-hidden">
        <ConnectingLog lines={[
          { text: '> Probing system resources...', delay: 400 },
          { text: '> Reading /proc/cpuinfo...', delay: 1000 },
          { text: '> Reading /proc/meminfo...', delay: 1800 },
          { text: '> Querying disk usage (df -h)...', delay: 2800 },
          { text: '> Scanning network interfaces...', delay: 3800 },
        ]} />
      </div>
    );
  }

  const memoryUsedPercent = clampPercent((stats.memory.used / stats.memory.total) * 100);

  return (
    <div className="h-full space-y-3 overflow-y-auto border-l border-border/50 bg-transparent p-3 font-sans text-foreground scrollbar-hide">
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 p-3 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={TerminalIcon} className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold tracking-tight">{stats.os.distro}</span>
        </div>
        <span className="rounded border border-border/30 bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {stats.os.uptime}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-3 rounded-lg border border-border/50 bg-card/40 p-4 shadow-sm backdrop-blur-md transition-colors hover:border-emerald-500/30">
          <div className="flex items-center justify-between border-b border-border/30 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <HugeiconsIcon icon={CpuIcon} className="h-4 w-4" />
              <span>CPU</span>
            </div>
            <span className="font-mono text-sm text-emerald-400">{stats.cpu.totalUsage}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/30">
            <div
              className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all duration-300 ease-out"
              style={{ width: `${clampPercent(stats.cpu.totalUsage)}%` }}
            />
          </div>

          <div className="grid gap-1 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(18px, 1fr))' }}>
            {stats.cpu.cores.map((core, index) => (
              <div key={index} className="relative h-7 overflow-hidden rounded-sm bg-secondary/20" title={`Core ${index}: ${core.usage}%`}>
                <div
                  className="absolute bottom-0 left-0 w-full bg-emerald-500/30 transition-all duration-300"
                  style={{ height: `${clampPercent(core.usage)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="truncate pt-1 font-mono text-[10px] text-muted-foreground opacity-60">
            {stats.cpu.model}
          </div>
        </div>

        <div
          className="group cursor-pointer space-y-3 rounded-lg border border-border/50 bg-card/40 p-4 shadow-sm backdrop-blur-md transition-all hover:border-violet-500/30"
          onClick={() => setShowProcesses(true)}
        >
          <div className="flex items-center justify-between border-b border-border/30 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-1.5 text-violet-400">
              <HugeiconsIcon icon={RamMemoryIcon} className="h-4 w-4" />
              <span>Memory</span>
            </div>
            <span className="font-mono transition-colors group-hover:text-violet-300">
              {stats.memory.used} / {stats.memory.total} GB
            </span>
          </div>

          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/30">
            <div
              className="h-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.3)] transition-all duration-300"
              style={{ width: `${memoryUsedPercent}%` }}
            />
          </div>

          <div className="flex justify-between pt-1 font-mono text-[10px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-500" />
                Used {memoryUsedPercent.toFixed(0)}%
              </span>
              <span>Cached {stats.memory.cached} GB</span>
            </div>
            <span className="opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-violet-300">View Processes →</span>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/50 bg-card/40 p-4 shadow-sm backdrop-blur-md transition-colors hover:border-blue-500/30">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-400">
            <HugeiconsIcon icon={AiNetworkIcon} className="h-4 w-4" />
            <span>Network</span>
          </div>
          <div className="flex gap-3 pt-0.5 font-mono text-[10px]">
            <span className="text-blue-400">↓ {(stats.network.downSpeed / 1024).toFixed(1)} KB/s</span>
            <span className="text-blue-300/70">↑ {(stats.network.upSpeed / 1024).toFixed(1)} KB/s</span>
          </div>

          <div className="-mx-1 h-24 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netHistory}>
                <defs>
                  <linearGradient id={networkGradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="down"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  fill={`url(#${networkGradientId})`}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="up"
                  stroke="#93c5fd"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                  fill="none"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-border/50 bg-card/40 p-4 shadow-sm backdrop-blur-md transition-colors hover:border-amber-500/30">
          <div className="flex items-center gap-1.5 border-b border-border/30 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <HugeiconsIcon icon={HardDriveIcon} className="h-4 w-4 text-amber-400" />
            <span>Storage</span>
          </div>

          <div className="space-y-4">
            {stats.disks.map((disk) => (
              <div key={`${disk.filesystem}:${disk.mount}`} className="space-y-1.5">
                <div className="flex justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate text-foreground/80">{disk.mount}</span>
                  <span className="shrink-0">{disk.used}G / {disk.size}G</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/30">
                  <div
                    className={clsx(
                      'h-full shadow-[0_0_8px_rgba(251,191,36,0.2)] transition-all duration-300',
                      disk.usePercent > 90 ? 'bg-red-500' : 'bg-amber-500',
                    )}
                    style={{ width: `${clampPercent(disk.usePercent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showProcesses && (
        <ProcessList connectionId={connectionId} onClose={() => setShowProcesses(false)} />
      )}
    </div>
  );
}
