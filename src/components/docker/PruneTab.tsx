import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Cancel01Icon, ContainerIcon, Delete02Icon, HardDriveIcon, PackageIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import type { DockerPruneType } from '../../shared/types';
import { errorMessage } from '../../lib/errors';

export function PruneTab({ connectionId, active }: { connectionId: string; active: boolean }) {
    const { t } = useTranslation();
    const [diskUsage, setDiskUsage] = useState('');
    const [loading, setLoading] = useState(false);
    const [pruneResult, setPruneResult] = useState<string | null>(null);
    const [pruning, setPruning] = useState<DockerPruneType | null>(null);
    const [pendingPrune, setPendingPrune] = useState<DockerPruneType | null>(null);

    const fetchDiskUsage = async () => {
        setLoading(true);
        try {
            const text = await window.electron.dockerDiskUsage(connectionId);
            setDiskUsage(text);
        } catch {
            setDiskUsage(t('dockerManager.diskUsageFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (active) void fetchDiskUsage();
    }, [active, connectionId]);

    const handlePrune = async (type: DockerPruneType) => {
        setPendingPrune(null);
        setPruning(type);
        setPruneResult(null);
        try {
            const result = await window.electron.dockerPrune(connectionId, type);
            setPruneResult(result);
            await fetchDiskUsage();
        } catch (err) {
            setPruneResult(`${t('common.error')}: ${errorMessage(err, type)}`);
        } finally {
            setPruning(null);
        }
    };

    const pruneActions: Array<{ type: DockerPruneType; label: string; icon: IconSvgElement; color: string; desc: string }> = [
        { type: 'containers', label: t('dockerManager.pruneContainers'), icon: ContainerIcon, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker container prune' },
        { type: 'images', label: t('dockerManager.pruneImages'), icon: PackageIcon, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker image prune -a' },
        { type: 'volumes', label: t('dockerManager.pruneVolumes'), icon: HardDriveIcon, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker volume prune' },
        { type: 'system', label: t('dockerManager.pruneSystem'), icon: Delete02Icon, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker system prune -af --volumes' },
    ];
    const pendingAction = pruneActions.find((action) => action.type === pendingPrune);

    return (
        <div className="flex h-full flex-col">
            <div className="space-y-2 border-b border-border/50 p-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <HugeiconsIcon icon={HardDriveIcon} className="h-4 w-4 text-muted-foreground" />
                        {t('docker.stats')}
                    </div>
                    <button type="button" onClick={fetchDiskUsage} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground" title={t('dockerManager.refresh')}>
                        <HugeiconsIcon icon={Refresh01Icon} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border/50 bg-background/35 p-2.5 font-mono text-[9px] leading-[1.6] text-muted-foreground">
                    {loading ? t('common.loading') : (diskUsage || t('common.loading'))}
                </pre>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {pruneActions.map((action) => (
                    <button
                        key={action.type}
                        onClick={() => setPendingPrune(action.type)}
                        disabled={Boolean(pruning)}
                        className={`w-full rounded-xl border border-border/65 bg-background/24 p-3 text-left transition-colors hover:border-foreground/20 disabled:opacity-40 ${action.color}`}
                    >
                        <div className="flex items-center gap-3">
                            <HugeiconsIcon icon={action.icon} className={`h-5 w-5 shrink-0 ${pruning === action.type ? 'animate-spin' : ''}`} />
                            <div className="min-w-0">
                                <div className="text-xs font-medium">{action.label}</div>
                                <div className="font-mono text-[10px] text-muted-foreground/60">{action.desc}</div>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {pendingAction && (
                <div className="border-t border-destructive/20 bg-destructive/[0.05] p-3">
                    <div className="text-[11px] font-medium text-foreground">{pendingAction.label}</div>
                    <div className="mt-1 font-mono text-[9px] text-muted-foreground">{pendingAction.desc}</div>
                    <div className="mt-2 text-[10px] text-destructive">
                        {t('dockerManager.confirm')} · {t('dockerManager.remove')}
                    </div>
                    <div className="mt-2 flex justify-end gap-1.5">
                        <button onClick={() => setPendingPrune(null)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary">
                            {t('dockerManager.cancel')}
                        </button>
                        <button onClick={() => handlePrune(pendingAction.type)} className="rounded bg-destructive px-2 py-1 text-[10px] text-destructive-foreground hover:bg-destructive/90">
                            {t('dockerManager.confirm')}
                        </button>
                    </div>
                </div>
            )}

            {pruneResult && (
                <div className="border-t border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground">{t('docker.prune')}</span>
                        <button onClick={() => setPruneResult(null)} className="rounded p-0.5 hover:bg-secondary">
                            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                        </button>
                    </div>
                    <pre className="max-h-[150px] overflow-x-auto overflow-y-auto whitespace-pre rounded-md bg-secondary/30 p-2 font-mono text-[10px] leading-[1.5] text-green-400/80">
                        {pruneResult}
                    </pre>
                </div>
            )}
        </div>
    );
}
