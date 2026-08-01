import { HugeiconsIcon } from '@hugeicons/react';
import { AiNetworkIcon, Clock01Icon, CpuIcon, HardDriveIcon, RamMemoryIcon } from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useState } from 'react';
import type { SystemStats } from '../shared/types';
import clsx from 'clsx';
import { DistroLogo } from './DistroLogo';
import { ProcessList } from './ProcessList';
import { ServerLocation } from './ServerLocation';
import { MonitorSkeleton } from './ui/skeleton';
import { useTranslation } from '../hooks/useTranslation';

interface SystemMonitorProps {
  connectionId: string;
  /** False while this session is behind another tab. */
  active: boolean;
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function compactUptime(value: string) {
  const units = [
    { pattern: /(\d+)\s+weeks?/i, suffix: 'w' },
    { pattern: /(\d+)\s+days?/i, suffix: 'd' },
    { pattern: /(\d+)\s+hours?/i, suffix: 'h' },
    { pattern: /(\d+)\s+minutes?/i, suffix: 'm' },
  ];
  const parts = units.flatMap(({ pattern, suffix }) => {
    const match = value.match(pattern);
    return match ? [`${match[1]}${suffix}`] : [];
  });
  return parts.length > 0 ? parts.slice(0, 3).join(' ') : value;
}

interface NetworkPoint {
  time: number;
  up: number;
  down: number;
}

function NetworkChart({ data, label }: { data: NetworkPoint[]; label: string }) {
  const geometry = useMemo(() => {
    const width = 320;
    const height = 88;
    const padding = 4;
    const maxValue = Math.max(1, ...data.flatMap((point) => [point.up, point.down]));
    const x = (index: number) => data.length <= 1 ? 0 : (index / (data.length - 1)) * width;
    const y = (value: number) => height - padding - (value / maxValue) * (height - padding * 2);
    const points = (key: 'up' | 'down') => data
      .map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`)
      .join(' ');
    const downPoints = points('down');

    return {
      width,
      height,
      upPoints: points('up'),
      downPoints,
      downArea: downPoints
        ? `M 0 ${height} L ${downPoints.split(' ').join(' L ')} L ${width} ${height} Z`
        : '',
    };
  }, [data]);

  return (
    <svg
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      <line x1="0" y1="29" x2={geometry.width} y2="29" stroke="currentColor" className="text-border/40" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1="58" x2={geometry.width} y2="58" stroke="currentColor" className="text-border/40" vectorEffect="non-scaling-stroke" />
      {geometry.downArea && <path d={geometry.downArea} fill="rgb(59 130 246 / 0.10)" />}
      <polyline points={geometry.downPoints} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <polyline points={geometry.upPoints} fill="none" stroke="#60a5fa" strokeWidth="1.25" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SystemMonitor({ connectionId, active }: SystemMonitorProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [showProcesses, setShowProcesses] = useState(false);
  const [netHistory, setNetHistory] = useState<NetworkPoint[]>([]);

  // Readings are kept for the life of the session. Only a different connection clears
  // them — switching tabs must not throw away the chart history.
  useEffect(() => {
    setStats(null);
    setNetHistory([]);
    setShowProcesses(false);

    return window.electron.onStatsUpdate((_, { id, stats: nextStats }) => {
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
  }, [connectionId]);

  // Polling is the only thing that stops when the session moves behind another tab, so
  // coming back shows the last readings immediately instead of a skeleton.
  useEffect(() => {
    let monitoring = false;

    const syncMonitoring = () => {
      const shouldMonitor = active && document.visibilityState !== 'hidden';
      if (shouldMonitor && !monitoring) {
        monitoring = true;
        window.electron.startMonitoring(connectionId);
      } else if (!shouldMonitor && monitoring) {
        monitoring = false;
        window.electron.stopMonitoring(connectionId);
      }
    };

    syncMonitoring();
    document.addEventListener('visibilitychange', syncMonitoring);

    return () => {
      document.removeEventListener('visibilitychange', syncMonitoring);
      if (monitoring) window.electron.stopMonitoring(connectionId);
    };
  }, [active, connectionId]);

  if (!stats) {
    return (
      <div className="h-full overflow-hidden border-l border-border/50">
        <MonitorSkeleton />
      </div>
    );
  }

  const memoryUsedPercent = clampPercent((stats.memory.used / stats.memory.total) * 100);

  return (
    <div className="h-full space-y-2 overflow-y-auto border-l border-border/50 bg-transparent p-2 font-sans text-foreground scrollbar-hide">
      {/* Distribution and uptime are separate facts, so they get separate tiles rather
          than sharing one row. The logo is the distro's own mark, picked from the
          reported name. */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/55 bg-card/35 px-3 py-2.5">
          <DistroLogo distro={stats.os.distro} className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs font-semibold tracking-tight" title={stats.os.distro}>
            {stats.os.distro}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/55 bg-card/35 px-3 py-2.5">
          <HugeiconsIcon icon={Clock01Icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs" title={stats.os.uptime}>
            {compactUptime(stats.os.uptime)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-2.5 rounded-xl border border-border/55 bg-card/35 p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-emerald-500">
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon icon={CpuIcon} className="h-3.5 w-3.5" />
              <span>CPU</span>
            </div>
            <span className="font-mono text-xs text-emerald-500">{stats.cpu.totalUsage}%</span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/60">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
              style={{ width: `${clampPercent(stats.cpu.totalUsage)}%` }}
            />
          </div>

          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(14px, 1fr))' }}>
            {stats.cpu.cores.map((core, index) => (
              <div key={index} className="relative h-4 overflow-hidden rounded-sm bg-secondary/40" title={`Core ${index}: ${core.usage}%`}>
                <div
                  className="absolute bottom-0 left-0 w-full bg-emerald-500/35 transition-all duration-300"
                  style={{ height: `${clampPercent(core.usage)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="truncate font-mono text-[9px] text-muted-foreground/65">
            {stats.cpu.model}
          </div>
        </div>

        <div
          className="group cursor-pointer space-y-2.5 rounded-xl border border-border/55 bg-card/35 p-3 transition-colors hover:bg-foreground/[0.035]"
          onClick={() => setShowProcesses(true)}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-violet-500">
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon icon={RamMemoryIcon} className="h-3.5 w-3.5" />
              <span>{t('monitor.memory')}</span>
            </div>
            <span className="shrink-0 font-mono text-[10px] normal-case tracking-normal text-foreground/80">
              {stats.memory.used} / {stats.memory.total} GB
            </span>
          </div>

          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary/60">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${memoryUsedPercent}%` }}
            />
          </div>

          <div className="flex justify-between gap-2 font-mono text-[9px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <span>{t('monitor.used')} {memoryUsedPercent.toFixed(0)}%</span>
              <span className="truncate">{t('monitor.cached')} {stats.memory.cached} GB</span>
            </div>
            <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">{t('monitor.viewProcesses')} →</span>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border/55 bg-card/35 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-500">
            <HugeiconsIcon icon={AiNetworkIcon} className="h-3.5 w-3.5" />
            <span>{t('monitor.network')}</span>
          </div>
          <div className="flex gap-3 pt-0.5 font-mono text-[10px]">
            <span className="text-blue-500">↓ {(stats.network.downSpeed / 1024).toFixed(1)} KB/s</span>
            <span className="text-blue-400">↑ {(stats.network.upSpeed / 1024).toFixed(1)} KB/s</span>
          </div>

          <div className="-mx-0.5 h-16 w-full pt-1">
            <NetworkChart data={netHistory} label={t('monitor.networkHistory')} />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border/55 bg-card/35 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">
            <HugeiconsIcon icon={HardDriveIcon} className="h-3.5 w-3.5" />
            <span>{t('monitor.storage')}</span>
          </div>

          <div className="space-y-2.5">
            {stats.disks.map((disk) => (
              <div key={`${disk.filesystem}:${disk.mount}`} className="space-y-1.5">
                <div className="flex justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate text-foreground/80">{disk.mount}</span>
                  <span className="shrink-0">{disk.used}G / {disk.size}G</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/60">
                  <div
                    className={clsx(
                      'h-full transition-all duration-300',
                      disk.usePercent > 90 ? 'bg-destructive' : 'bg-amber-500',
                    )}
                    style={{ width: `${clampPercent(disk.usePercent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ServerLocation timezone={stats.os.timezone} />

      {showProcesses && (
        <ProcessList connectionId={connectionId} onClose={() => setShowProcesses(false)} />
      )}
    </div>
  );
}
