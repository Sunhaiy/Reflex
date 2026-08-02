import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Cancel01Icon, ContainerIcon, Delete02Icon, FileAttachmentIcon, Layers01Icon, PauseIcon, PlayIcon, Refresh01Icon, RotateRight01Icon, Search01Icon, SquareIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import type { DockerAction, DockerContainer } from '../../shared/types';
import type { ContainerFilter, DockerTabProps } from './types';
import { LogViewer } from './LogViewer';
import { errorMessage } from '../../lib/errors';

export function ContainersTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ContainerFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
    const fetchInFlightRef = useRef(false);

    const actionLabels: Record<string, string> = {
        start: t('dockerManager.start'),
        stop: t('dockerManager.stop'),
        restart: t('dockerManager.restart'),
        pause: t('dockerManager.pause'),
        unpause: t('dockerManager.resume'),
        remove: t('dockerManager.remove'),
    };

    const fetchContainers = async () => {
        if (fetchInFlightRef.current) return;
        fetchInFlightRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const list = await window.electron.getDockerContainers(connectionId);
            setContainers(list);
        } catch (err) {
            setError(errorMessage(err, t('dockerManager.fetchContainersFailed')));
        } finally {
            fetchInFlightRef.current = false;
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = window.setInterval(fetchContainers, 8000);
        return () => window.clearInterval(interval);
    }, [connectionId]);

    const handleAction = async (containerId: string, action: DockerAction) => {
        setActionLoading(containerId);
        setActionMsg(null);
        try {
            await window.electron.dockerAction(connectionId, containerId, action);
            setActionMsg(`${t('dockerManager.actionSucceeded')}: ${actionLabels[action] || action} ${containerId.substring(0, 12)}`);
            window.setTimeout(() => setActionMsg(null), 3000);
            await fetchContainers();
        } catch (err) {
            setError(`${t('dockerManager.actionFailed')}: ${errorMessage(err, action)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleExec = (containerId: string) => {
        window.electron.writeTerminal(connectionId, `docker exec -it ${containerId} /bin/sh\n`);
    };

    const composeProjects = useMemo(() => {
        const projects = new Map<string, DockerContainer[]>();
        containers.forEach((container) => {
            if (!container.composeProject) return;
            const group = projects.get(container.composeProject) || [];
            group.push(container);
            projects.set(container.composeProject, group);
        });
        return projects;
    }, [containers]);

    const filtered = useMemo(() => {
        let list = containers;
        if (filter === 'running') list = list.filter((item) => item.state?.toLowerCase() === 'running');
        if (filter === 'stopped') list = list.filter((item) => item.state?.toLowerCase() !== 'running');
        if (searchTerm) {
            const keyword = searchTerm.toLowerCase();
            list = list.filter((item) =>
                item.name.toLowerCase().includes(keyword) || item.image.toLowerCase().includes(keyword),
            );
        }
        return list;
    }, [containers, filter, searchTerm]);

    const counts = useMemo(() => ({
        all: containers.length,
        running: containers.filter((item) => item.state?.toLowerCase() === 'running').length,
        stopped: containers.filter((item) => item.state?.toLowerCase() !== 'running').length,
    }), [containers]);

    const filterLabel = (value: ContainerFilter) => {
        if (value === 'running') return t('dockerManager.running');
        if (value === 'stopped') return t('dockerManager.stopped');
        return t('dockerManager.all');
    };

    const getStateColor = (state: string) => {
        const normalized = state?.toLowerCase();
        if (normalized === 'running') return 'bg-primary';
        if (normalized === 'paused') return 'bg-yellow-500';
        if (normalized === 'exited') return 'bg-muted-foreground/50';
        return 'bg-red-400';
    };

    const getStateBadge = (state: string) => {
        const normalized = state?.toLowerCase();
        if (normalized === 'running') return 'bg-primary/15 text-primary';
        if (normalized === 'paused') return 'bg-yellow-500/15 text-yellow-500';
        return 'bg-muted text-muted-foreground';
    };

    return (
        <div className="flex h-full flex-col">
            <div className="space-y-2 border-b border-border/50 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-medium">{t('docker.containers')}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {counts.running} {t('dockerManager.running')} · {counts.all} {t('dockerManager.all')}
                        </div>
                    </div>
                    <button type="button" onClick={fetchContainers} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title={t('dockerManager.refresh')}>
                        <HugeiconsIcon icon={Refresh01Icon} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <label className="relative flex h-8 items-center rounded-lg border border-border/55 bg-background/38">
                    <HugeiconsIcon icon={Search01Icon} className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={t('dockerManager.searchContainers')}
                        className="h-full w-full bg-transparent pl-8 pr-8 text-[11px] outline-none placeholder:text-muted-foreground/60"
                    />
                    {searchTerm && (
                        <button type="button" onClick={() => setSearchTerm('')} className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                        </button>
                    )}
                </label>

                <div className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/[0.035] p-1 text-[10px]">
                    {(['all', 'running', 'stopped'] as ContainerFilter[]).map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setFilter(value)}
                            className={cn(
                                'flex h-7 items-center justify-center gap-1 rounded-md px-2 text-muted-foreground transition-colors hover:text-foreground',
                                filter === value && 'bg-background/80 text-foreground',
                            )}
                        >
                            {filterLabel(value)}
                            <span className="tabular-nums opacity-55">{counts[value]}</span>
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <HugeiconsIcon icon={AlertCircleIcon} className="h-3.5 w-3.5 shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto">
                        <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                    </button>
                </div>
            )}

            {actionMsg && (
                <div className="mx-3 mt-2 rounded-md bg-primary/10 p-2 font-mono text-[11px] text-primary">
                    {actionMsg}
                </div>
            )}

            {composeProjects.size > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                    {Array.from(composeProjects.entries()).map(([project, projectContainers]) => {
                        const running = projectContainers.filter((item) => item.state?.toLowerCase() === 'running').length;
                        return (
                            <div key={project} className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/32 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                <HugeiconsIcon icon={Layers01Icon} className="h-3 w-3" />
                                {project}
                                <span className="opacity-60">{running}/{projectContainers.length}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {filtered.length === 0 && !loading && !error && (
                    <div className="py-8 text-center text-xs text-muted-foreground opacity-70">
                        <HugeiconsIcon icon={ContainerIcon} className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        {t('dockerManager.noContainers')}
                    </div>
                )}

                {filtered.map((container) => (
                    <div key={container.id} className="overflow-hidden rounded-xl border border-border/65 bg-background/24 transition-colors hover:border-foreground/20">
                        <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 truncate text-xs font-medium">
                                        <div className={`h-2 w-2 shrink-0 rounded-full ${getStateColor(container.state)}`} />
                                        {container.name}
                                        {container.composeProject && (
                                            <span className="rounded border border-border/50 px-1.5 py-0 font-mono text-[9px] text-muted-foreground">
                                                {container.composeProject}
                                            </span>
                                        )}
                                    </div>
                                    <div className="ml-4 mt-1 truncate text-[10px] text-muted-foreground">
                                        {container.image}
                                    </div>
                                </div>
                                <span className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-medium ${getStateBadge(container.state)}`}>
                                    {container.state || 'unknown'}
                                </span>
                            </div>

                            <div className="mt-2 space-y-1.5">
                                <div className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground/60">
                                    <span>{container.id.substring(0, 12)}</span>
                                    {container.ports && <span className="truncate" title={container.ports}>{container.ports}</span>}
                                </div>
                                {container.status && <div className="truncate text-[9px] text-muted-foreground/55">{container.status}</div>}

                                <div className="flex flex-wrap items-center gap-1 border-t border-border/45 pt-2">
                                    <button
                                        onClick={() => setExpandedId(expandedId === container.id ? null : container.id)}
                                        className={cn(
                                            'flex h-7 items-center gap-1 rounded-lg px-2 text-[9px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                                            expandedId === container.id && 'bg-foreground/[0.08] text-foreground',
                                        )}
                                        title={t('dockerManager.logs')}
                                    >
                                        <HugeiconsIcon icon={FileAttachmentIcon} className="h-3.5 w-3.5" />
                                        {t('dockerManager.logs')}
                                    </button>

                                    <button
                                        onClick={() => handleExec(container.id)}
                                        disabled={container.state?.toLowerCase() !== 'running'}
                                        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[9px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
                                        title={t('dockerManager.exec')}
                                    >
                                        <HugeiconsIcon icon={TerminalIcon} className="h-3.5 w-3.5" />
                                        {t('dockerManager.exec')}
                                    </button>

                                    <button
                                        onClick={() => handleAction(container.id, 'start')}
                                        disabled={Boolean(actionLoading) || container.state?.toLowerCase() === 'running'}
                                        className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                                        title={t('dockerManager.start')}
                                    >
                                        <HugeiconsIcon icon={PlayIcon} className="h-3.5 w-3.5" />
                                    </button>

                                    {container.state?.toLowerCase() === 'paused' ? (
                                        <button
                                            onClick={() => handleAction(container.id, 'unpause')}
                                            disabled={Boolean(actionLoading)}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                                            title={t('dockerManager.resume')}
                                        >
                                            <HugeiconsIcon icon={PlayIcon} className="h-3.5 w-3.5" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleAction(container.id, 'pause')}
                                            disabled={Boolean(actionLoading) || container.state?.toLowerCase() !== 'running'}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                                            title={t('dockerManager.pause')}
                                        >
                                            <HugeiconsIcon icon={PauseIcon} className="h-3.5 w-3.5" />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleAction(container.id, 'restart')}
                                        disabled={Boolean(actionLoading)}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                                        title={t('dockerManager.restart')}
                                    >
                                        <HugeiconsIcon icon={RotateRight01Icon} className={`h-3.5 w-3.5 ${actionLoading === container.id ? 'animate-spin' : ''}`} />
                                    </button>

                                    <button
                                        onClick={() => handleAction(container.id, 'stop')}
                                        disabled={Boolean(actionLoading) || container.state?.toLowerCase() !== 'running'}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
                                        title={t('dockerManager.stop')}
                                    >
                                        <HugeiconsIcon icon={SquareIcon} className="h-3.5 w-3.5 fill-current" />
                                    </button>

                                    {pendingConfirm === container.id ? (
                                        <>
                                            <button
                                                onClick={() => setPendingConfirm(null)}
                                                className="h-7 rounded-lg px-2 text-[9px] text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
                                            >
                                                {t('dockerManager.cancel')}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setPendingConfirm(null);
                                                    handleAction(container.id, 'remove');
                                                }}
                                                className="h-7 rounded-lg bg-destructive/10 px-2 text-[9px] text-destructive transition-colors hover:bg-destructive/20"
                                            >
                                                {t('dockerManager.confirm')}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setPendingConfirm(container.id)}
                                            disabled={Boolean(actionLoading)}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-20"
                                            title={t('dockerManager.remove')}
                                        >
                                            <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {expandedId === container.id && (
                            <LogViewer connectionId={connectionId} containerId={container.id} containerName={container.name} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
