import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PowerIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../hooks/useTranslation';
import type { RemoteProcess } from '../shared/types';
import { errorMessage } from '../lib/errors';

interface ProcessListProps {
    connectionId: string;
    onClose: () => void;
}

export function ProcessList({ connectionId, onClose }: ProcessListProps) {
    const { t } = useTranslation();
    const [processes, setProcesses] = useState<RemoteProcess[]>([]);
    const [loading, setLoading] = useState(false);
    const [sortBy, setSortBy] = useState<'cpu' | 'mem'>('cpu');
    const [error, setError] = useState<string | null>(null);

    const fetchProcesses = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await window.electron.getProcesses(connectionId);
            // Backend returns top 50 sorted by cpu. We can re-sort if needed.
            const sorted = [...list].sort((a, b) => b[sortBy] - a[sortBy]).slice(0, 50);
            setProcesses(sorted);
        } catch (err) {
            setError(errorMessage(err, t('common.error')));
        } finally {
            setLoading(false);
        }
    };

    // `ps -ax` shares the SSH connection with the shell, so it is not worth running
    // while the window is hidden — the output would only compete with terminal traffic.
    useEffect(() => {
        let interval: number | undefined;

        const start = () => {
            if (interval !== undefined) return;
            void fetchProcesses();
            interval = window.setInterval(fetchProcesses, 5000);
        };
        const stop = () => {
            if (interval === undefined) return;
            window.clearInterval(interval);
            interval = undefined;
        };
        const sync = () => (document.visibilityState === 'hidden' ? stop() : start());

        sync();
        document.addEventListener('visibilitychange', sync);
        return () => {
            document.removeEventListener('visibilitychange', sync);
            stop();
        };
    }, [connectionId, sortBy]);

    const handleKill = async (pid: number) => {
        if (!confirm(`${t('processList.confirmKill')} PID ${pid}?`)) return;
        try {
            await window.electron.killProcess(connectionId, pid);
            fetchProcesses(); // Refresh immediately
        } catch (err) {
            alert(`${t('common.error')}: ${errorMessage(err)}`);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex h-[min(600px,calc(100vh-32px))] w-[min(800px,calc(100vw-32px))] flex-col rounded-lg border border-border bg-card">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        {t('processList.title')}
                    </h2>
                    <div className="flex items-center gap-2">
                        <button onClick={fetchProcesses} className="p-2 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title={t('common.refresh')}>
                            <HugeiconsIcon icon={Refresh01Icon} className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title={t('common.close')}>
                            <HugeiconsIcon icon={Cancel01Icon} className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Filters/Sort */}
                <div className="p-2 border-b border-border bg-secondary/30 flex gap-2">
                    <button
                        onClick={() => setSortBy('cpu')}
                        className={`px-3 py-1 text-xs rounded transition-colors ${sortBy === 'cpu' ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'}`}
                    >
                        {t('processList.cpu')} ↓
                    </button>
                    <button
                        onClick={() => setSortBy('mem')}
                        className={`px-3 py-1 text-xs rounded transition-colors ${sortBy === 'mem' ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'}`}
                    >
                        {t('processList.mem')} ↓
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-auto">
                    {error ? (
                        <div className="p-8 text-center text-destructive">{error}</div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-muted-foreground bg-secondary/50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 font-medium">PID</th>
                                    <th className="px-4 py-2 font-medium">{t('processList.user')}</th>
                                    <th className="px-4 py-2 font-medium">CPU %</th>
                                    <th className="px-4 py-2 font-medium">Mem %</th>
                                    <th className="px-4 py-2 font-medium">{t('processList.command')}</th>
                                    <th className="px-4 py-2 font-medium text-right" />
                                </tr>
                            </thead>
                            <tbody>
                                {processes.map(proc => (
                                    <tr key={proc.pid} className="border-b border-border/50 hover:bg-secondary/50 transition-colors group">
                                        <td className="px-4 py-2 font-medium tabular-nums text-xs">{proc.pid}</td>
                                        <td className="px-4 py-2 font-medium">{proc.user}</td>
                                        <td className={`px-4 py-2 font-medium tabular-nums ${proc.cpu > 50 ? 'text-red-500 font-bold' : proc.cpu > 20 ? 'text-yellow-500' : ''}`}>
                                            {proc.cpu.toFixed(1)}%
                                        </td>
                                        <td className="px-4 py-2 font-medium tabular-nums">{proc.mem.toFixed(1)}</td>
                                        <td className="px-4 py-2 max-w-[200px] truncate" title={proc.args || proc.command}>
                                            <span className="font-medium">{proc.command}</span>
                                            <span className="text-muted-foreground text-xs ml-2 opacity-70">{proc.args}</span>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            <button
                                                onClick={() => handleKill(proc.pid)}
                                                className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded opacity-0 group-hover:opacity-100 transition-all"
                                                title={t('processList.kill')}
                                            >
                                                <HugeiconsIcon icon={PowerIcon} className="w-3.5 h-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
