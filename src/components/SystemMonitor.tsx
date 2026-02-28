import { useEffect, useState } from 'react';
import { SystemStats } from '../shared/types';
import {
    AreaChart, Area, ResponsiveContainer
} from 'recharts';
import {
    Cpu, HardDrive, Network, Activity, MemoryStick, Terminal as TerminalIcon
} from 'lucide-react';
import clsx from 'clsx';
import { ProcessList } from './ProcessList';
import { ConnectingLog } from './ConnectingOverlay';

interface SystemMonitorProps {
    connectionId: string;
}

export function SystemMonitor({ connectionId }: SystemMonitorProps) {
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [showProcesses, setShowProcesses] = useState(false);
    const [netHistory, setNetHistory] = useState<{ time: number; up: number; down: number }[]>([]);

    useEffect(() => {
        window.electron.startMonitoring(connectionId);

        const cleanup = window.electron.onStatsUpdate((_, { id, stats }) => {
            if (id === connectionId) {
                setStats(stats);
                setNetHistory(prev => {
                    const next = [...prev, {
                        time: Date.now(),
                        up: stats.network.upSpeed / 1024, // KB/s
                        down: stats.network.downSpeed / 1024 // KB/s
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

    return (
        <div className="h-full bg-transparent text-foreground p-4 overflow-y-auto space-y-4 font-sans border-l border-border/50 scrollbar-hide">

            {/* Header / OS Info - Card Style */}
            <div className="bg-card/40 border border-border/50 rounded-lg p-3 flex items-center justify-between shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <TerminalIcon className="w-4 h-4 text-primary" />
                    <span className="font-bold text-sm tracking-tight">{stats.os.distro}</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/30">
                    {stats.os.uptime}
                </span>
            </div>

            {/* Resources Grid */}
            <div className="grid grid-cols-1 gap-4">

                {/* CPU Card */}
                <div className="bg-card/40 border border-border/50 rounded-lg p-4 space-y-3 shadow-sm hover:border-emerald-500/30 transition-colors backdrop-blur-md">
                    <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/30 pb-2">
                        <div className="flex items-center gap-1.5 text-emerald-400">
                            <Cpu className="w-4 h-4" />
                            <span>CPU</span>
                        </div>
                        <span className="text-emerald-400 font-mono text-sm">{stats.cpu.totalUsage}%</span>
                    </div>

                    <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                            style={{ width: `${stats.cpu.totalUsage}%` }}
                        />
                    </div>

                    <div className="grid grid-cols-8 gap-1 pt-1">
                        {stats.cpu.cores.map((core, i) => (
                            <div key={i} className="h-8 bg-secondary/20 rounded-sm relative overflow-hidden group" title={`Core ${i}: ${core.usage}%`}>
                                <div
                                    className="absolute bottom-0 left-0 w-full bg-emerald-500/30 transition-all duration-300"
                                    style={{ height: `${core.usage}%` }}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate font-mono opacity-60 pt-1">
                        {stats.cpu.model}
                    </div>
                </div>

                {/* Memory Card */}
                <div
                    className="bg-card/40 border border-border/50 rounded-lg p-4 space-y-3 shadow-sm cursor-pointer hover:border-violet-500/30 transition-all group backdrop-blur-md"
                    onClick={() => setShowProcesses(true)}
                >
                    <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/30 pb-2">
                        <div className="flex items-center gap-1.5 text-violet-400">
                            <MemoryStick className="w-4 h-4" />
                            <span>Memory</span>
                        </div>
                        <span className="group-hover:text-violet-300 transition-colors font-mono">
                            {stats.memory.used} / {stats.memory.total} GB
                        </span>
                    </div>

                    <div className="flex h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-violet-500 transition-all duration-300 shadow-[0_0_10px_rgba(139,92,246,0.3)]"
                            style={{ width: `${(stats.memory.used / stats.memory.total) * 100}%` }}
                        />
                        <div
                            className="h-full bg-violet-400/30 transition-all duration-300"
                            style={{ width: `${(stats.memory.cached / stats.memory.total) * 100}%` }}
                        />
                    </div>

                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono pt-1">
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500" /> Used</span>
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500/30" /> Cached</span>
                        </div>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-violet-300">View Processes →</span>
                    </div>
                </div>

                {/* Network Card */}
                <div className="bg-card/40 border border-border/50 rounded-lg p-4 space-y-3 shadow-sm hover:border-blue-500/30 transition-colors backdrop-blur-md">
                    <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/30 pb-2">
                        <div className="flex items-center gap-1.5 text-blue-400">
                            <Network className="w-4 h-4" />
                            <span>Network</span>
                        </div>
                        <div className="flex gap-3 font-mono text-[10px]">
                            <span className="text-blue-400">↓ {(stats.network.downSpeed / 1024).toFixed(1)} KB/s</span>
                            <span className="text-blue-300/70">↑ {(stats.network.upSpeed / 1024).toFixed(1)} KB/s</span>
                        </div>
                    </div>

                    <div className="h-24 w-full -mx-1 pt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={netHistory}>
                                <defs>
                                    <linearGradient id="netGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <Area
                                    type="monotone"
                                    dataKey="down"
                                    stroke="#60a5fa"
                                    strokeWidth={2}
                                    fill="url(#netGradient)"
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

                {/* Disk Card */}
                <div className="bg-card/40 border border-border/50 rounded-lg p-4 space-y-4 shadow-sm hover:border-amber-500/30 transition-colors backdrop-blur-md">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/30 pb-2">
                        <HardDrive className="w-4 h-4 text-amber-400" />
                        <span>Storage</span>
                    </div>

                    <div className="space-y-4">
                        {stats.disks.map((disk, idx) => (
                            <div key={idx} className="space-y-1.5">
                                <div className="flex justify-between text-[11px] font-mono text-muted-foreground gap-2">
                                    <span className="text-foreground/80 truncate min-w-0">{disk.mount}</span>
                                    <span className="shrink-0">{disk.used}G / {disk.size}G</span>
                                </div>
                                <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                    <div
                                        className={clsx(
                                            "h-full transition-all duration-300 shadow-[0_0_8px_rgba(251,191,36,0.2)]",
                                            disk.usePercent > 90 ? "bg-red-500" : "bg-amber-500"
                                        )}
                                        style={{ width: `${disk.usePercent}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Process List Modal */}
            {showProcesses && (
                <ProcessList connectionId={connectionId} onClose={() => setShowProcesses(false)} />
            )}
        </div>
    );
}
