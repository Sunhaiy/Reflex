import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { AlertCircleIcon, Cancel01Icon, ContainerIcon, Delete02Icon, FileAttachmentIcon, HardDriveIcon, Layers01Icon, PackageIcon, PauseIcon, PlayIcon, Refresh01Icon, RotateRight01Icon, Search01Icon, SquareIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import type { DockerAction, DockerContainer, DockerImage, DockerPruneType } from '../shared/types';

interface DockerManagerProps {
    connectionId: string;
}

type TabId = 'containers' | 'images' | 'prune';
type ContainerFilter = 'all' | 'running' | 'stopped';

export function DockerManager({ connectionId }: DockerManagerProps) {
    const [tab, setTab] = useState<TabId>('containers');
    const { t } = useTranslation();

    const tabs: { id: TabId; label: string; icon: IconSvgElement }[] = [
        { id: 'containers', label: t('docker.containers'), icon: ContainerIcon },
        { id: 'images', label: t('docker.images'), icon: PackageIcon },
        { id: 'prune', label: t('docker.prune'), icon: Delete02Icon },
    ];

    return (
        <div className="flex h-full flex-col bg-transparent text-foreground">
            <div className="shrink-0 border-b border-border/50 p-2">
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-foreground/[0.035] p-1">
                    {tabs.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            className={cn(
                                'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground',
                                tab === item.id && 'bg-background/80 text-foreground',
                            )}
                        >
                            <HugeiconsIcon icon={item.icon} className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                {tab === 'containers' && <ContainersTab connectionId={connectionId} />}
                {tab === 'images' && <ImagesTab connectionId={connectionId} />}
                {tab === 'prune' && <PruneTab connectionId={connectionId} />}
            </div>
        </div>
    );
}

function ContainersTab({ connectionId }: { connectionId: string }) {
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
        } catch (err: any) {
            setError(err?.message || t('dockerManager.fetchContainersFailed'));
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
        } catch (err: any) {
            setError(`${t('dockerManager.actionFailed')}: ${err?.message || action}`);
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

function LogViewer({ connectionId, containerId, containerName }: { connectionId: string; containerId: string; containerName: string }) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const text = await window.electron.dockerLogs(connectionId, containerId, 300);
            setLogs(text);
            window.setTimeout(() => logRef.current?.scrollTo(0, logRef.current!.scrollHeight), 50);
        } catch {
            setLogs(t('dockerManager.fetchLogsFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [containerId]);

    const lines = logs.split('\n');
    const filteredLines = searchTerm
        ? lines.filter((line) => line.toLowerCase().includes(searchTerm.toLowerCase()))
        : lines;

    const highlightSearch = (line: string) => {
        if (!searchTerm) return line;
        const idx = line.toLowerCase().indexOf(searchTerm.toLowerCase());
        if (idx === -1) return line;
        return (
            <>
                {line.slice(0, idx)}
                <span className="rounded bg-yellow-500/30 px-0.5 text-yellow-200">
                    {line.slice(idx, idx + searchTerm.length)}
                </span>
                {line.slice(idx + searchTerm.length)}
            </>
        );
    };

    return (
        <div className="border-t border-border bg-background/80">
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
                <HugeiconsIcon icon={FileAttachmentIcon} className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">{containerName} {t('dockerManager.logs')}</span>
                <div className="relative flex-1">
                    <HugeiconsIcon icon={Search01Icon} className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('common.search')}
                        className="w-full rounded border border-transparent bg-secondary/50 py-0.5 pl-6 pr-2 text-[10px] outline-none focus:border-primary/50"
                    />
                </div>
                <button onClick={fetchLogs} className="rounded p-1 hover:bg-secondary" title={t('dockerManager.refresh')}>
                    <HugeiconsIcon icon={Refresh01Icon} className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div ref={logRef} className="scrollbar-hide h-[200px] overflow-y-auto p-2 font-mono text-[10px] leading-[1.6] text-muted-foreground">
                {filteredLines.map((line, index) => (
                    <div key={index} className="whitespace-pre-wrap break-all px-1 hover:bg-muted/30">
                        {highlightSearch(line)}
                    </div>
                ))}
                {loading && (
                    <div className="py-4 text-center text-muted-foreground/50 animate-pulse">
                        {t('dockerManager.loading')}
                    </div>
                )}
            </div>
        </div>
    );
}

function ImagesTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [images, setImages] = useState<DockerImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchImages = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await window.electron.dockerImages(connectionId);
            setImages(list);
        } catch (err: any) {
            setError(err?.message || t('common.error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchImages();
    }, [connectionId]);

    const handleDelete = async (imageId: string) => {
        setPendingDelete(null);
        setDeleting(imageId);
        try {
            await window.electron.dockerRemoveImage(connectionId, imageId);
            await fetchImages();
        } catch (err: any) {
            setError(err?.message || t('common.error'));
        } finally {
            setDeleting(null);
        }
    };

    const pendingImage = images.find((image) => image.id === pendingDelete);
    const filteredImages = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        if (!keyword) return images;
        return images.filter((image) =>
            `${image.repository}:${image.tag} ${image.id}`.toLowerCase().includes(keyword),
        );
    }, [images, searchTerm]);

    return (
        <div className="flex h-full flex-col">
            <div className="space-y-2 border-b border-border/50 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs">
                        <HugeiconsIcon icon={PackageIcon} className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{t('docker.images')}</span>
                        <span className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{images.length}</span>
                    </div>
                    <button type="button" onClick={fetchImages} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title={t('dockerManager.refresh')}>
                        <HugeiconsIcon icon={Refresh01Icon} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <label className="relative flex h-8 items-center rounded-lg border border-border/55 bg-background/38">
                    <HugeiconsIcon icon={Search01Icon} className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={t('common.search')}
                        className="h-full w-full bg-transparent pl-8 pr-8 text-[11px] outline-none placeholder:text-muted-foreground/60"
                    />
                    {searchTerm && (
                        <button type="button" onClick={() => setSearchTerm('')} className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                        </button>
                    )}
                </label>
            </div>

            {error && (
                <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
                    <HugeiconsIcon icon={AlertCircleIcon} className="h-3.5 w-3.5" />
                    {error}
                </div>
            )}

            {pendingImage && (
                <div className="mx-3 mt-2 rounded-md border border-destructive/25 bg-destructive/[0.06] p-2.5 text-[11px]">
                    <div className="break-all text-foreground/90">
                        {t('dockerManager.remove')} {pendingImage.repository}:{pendingImage.tag}?
                    </div>
                    <div className="mt-2 flex justify-end gap-1.5">
                        <button onClick={() => setPendingDelete(null)} className="rounded px-2 py-1 text-muted-foreground hover:bg-secondary">
                            {t('dockerManager.cancel')}
                        </button>
                        <button onClick={() => handleDelete(pendingImage.id)} className="rounded bg-destructive px-2 py-1 text-destructive-foreground hover:bg-destructive/90">
                            {t('dockerManager.confirm')}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {filteredImages.map((image) => (
                    <div key={image.id} className="rounded-xl border border-border/65 bg-background/24 p-3 transition-colors hover:border-foreground/20">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-xs text-foreground/90">
                                    {image.repository}<span className="text-muted-foreground">:{image.tag}</span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/60">
                                    <span className="font-mono">{image.size}</span>
                                    <span>{image.created}</span>
                                    <span className="font-mono">{image.id.substring(0, 12)}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setPendingDelete(image.id)}
                                disabled={Boolean(deleting)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-20"
                                title={t('dockerManager.remove')}
                            >
                                <HugeiconsIcon icon={Delete02Icon} className={`h-3.5 w-3.5 ${deleting === image.id ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>
                ))}

                {filteredImages.length === 0 && !loading && (
                    <div className="py-8 text-center text-xs text-muted-foreground opacity-70">
                        <HugeiconsIcon icon={PackageIcon} className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        {t('docker.noDockerHint')}
                    </div>
                )}
            </div>
        </div>
    );
}

function PruneTab({ connectionId }: { connectionId: string }) {
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
        fetchDiskUsage();
    }, [connectionId]);

    const handlePrune = async (type: DockerPruneType) => {
        setPendingPrune(null);
        setPruning(type);
        setPruneResult(null);
        try {
            const result = await window.electron.dockerPrune(connectionId, type);
            setPruneResult(result);
            await fetchDiskUsage();
        } catch (err: any) {
            setPruneResult(`${t('common.error')}: ${err?.message || type}`);
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
