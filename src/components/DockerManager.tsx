import { useEffect, useState, useRef, useMemo } from 'react';
import {
    RefreshCw, Play, Square, RotateCw, Container, AlertCircle,
    Trash2, Pause, Terminal, FileText, HardDrive, Package,
    Search, ChevronDown, ChevronUp, X, Layers, DownloadCloud
} from 'lucide-react';

// ─── Types ───
interface DockerContainer {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string;
    ports: string;
    composeProject: string;
}

interface DockerImage {
    id: string;
    repository: string;
    tag: string;
    size: string;
    created: string;
}

interface DockerManagerProps {
    connectionId: string;
}

type TabId = 'containers' | 'images' | 'prune';
type ContainerFilter = 'all' | 'running' | 'stopped';

// ─── Main Component ───
export function DockerManager({ connectionId }: DockerManagerProps) {
    const [tab, setTab] = useState<TabId>('containers');

    const tabs: { id: TabId; label: string; icon: any }[] = [
        { id: 'containers', label: '容器', icon: Container },
        { id: 'images', label: '镜像', icon: Package },
        { id: 'prune', label: '清理', icon: Trash2 },
    ];

    return (
        <div className="h-full flex flex-col bg-transparent text-foreground">
            {/* Tab Header */}
            <div className="flex border-b border-border bg-muted/30">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors
                            ${tab === t.id
                                ? 'text-primary border-b-2 border-primary bg-primary/5'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                    >
                        <t.icon className="w-3.5 h-3.5" />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
                {tab === 'containers' && <ContainersTab connectionId={connectionId} />}
                {tab === 'images' && <ImagesTab connectionId={connectionId} />}
                {tab === 'prune' && <PruneTab connectionId={connectionId} />}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// Containers Tab
// ═══════════════════════════════════════════════════════════
function ContainersTab({ connectionId }: { connectionId: string }) {
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ContainerFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchContainers = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await (window as any).electron.getDockerContainers(connectionId);
            setContainers(list);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch containers');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = setInterval(fetchContainers, 8000);
        return () => clearInterval(interval);
    }, [connectionId]);

    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

    const actionLabels: Record<string, string> = {
        start: '启动', stop: '停止', restart: '重启', pause: '暂停', unpause: '恢复', remove: '删除'
    };

    const handleAction = async (containerId: string, action: string) => {
        setActionLoading(containerId);
        setActionMsg(null);
        try {
            await (window as any).electron.dockerAction(connectionId, containerId, action);
            setActionMsg(`✓ 已${actionLabels[action] || action} ${containerId.substring(0, 12)}`);
            setTimeout(() => setActionMsg(null), 3000);
            await fetchContainers();
        } catch (err: any) {
            setError(`操作失败: ${err.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleExec = (containerId: string) => {
        (window as any).electron?.writeTerminal(connectionId, `docker exec -it ${containerId} /bin/sh\n`);
    };

    // Group by compose project
    const composeProjects = useMemo(() => {
        const projects = new Map<string, DockerContainer[]>();
        containers.forEach(c => {
            if (c.composeProject) {
                const list = projects.get(c.composeProject) || [];
                list.push(c);
                projects.set(c.composeProject, list);
            }
        });
        return projects;
    }, [containers]);

    const filtered = useMemo(() => {
        let list = containers;
        if (filter === 'running') list = list.filter(c => c.state?.toLowerCase() === 'running');
        if (filter === 'stopped') list = list.filter(c => c.state?.toLowerCase() !== 'running');
        if (searchTerm) list = list.filter(c =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.image.toLowerCase().includes(searchTerm.toLowerCase())
        );
        return list;
    }, [containers, filter, searchTerm]);

    const getStateColor = (state: string) => {
        const s = state?.toLowerCase();
        if (s === 'running') return 'bg-green-500';
        if (s === 'paused') return 'bg-yellow-500';
        if (s === 'exited') return 'bg-muted-foreground/50';
        return 'bg-red-400';
    };

    const getStateBadge = (state: string) => {
        const s = state?.toLowerCase();
        if (s === 'running') return 'bg-green-500/15 text-green-500';
        if (s === 'paused') return 'bg-yellow-500/15 text-yellow-500';
        return 'bg-muted text-muted-foreground';
    };

    const counts = useMemo(() => ({
        all: containers.length,
        running: containers.filter(c => c.state?.toLowerCase() === 'running').length,
        stopped: containers.filter(c => c.state?.toLowerCase() !== 'running').length,
    }), [containers]);

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="p-3 flex items-center gap-2 border-b border-border/50">
                <div className="flex items-center bg-secondary/50 rounded-md text-[11px] overflow-hidden">
                    {(['all', 'running', 'stopped'] as ContainerFilter[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2.5 py-1 transition-colors ${filter === f
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-secondary text-muted-foreground'
                                }`}
                        >
                            {f === 'all' ? '全部' : f === 'running' ? '运行中' : '已停止'}
                            <span className="ml-1 opacity-60">{counts[f]}</span>
                        </button>
                    ))}
                </div>

                <div className="flex-1 relative">
                    <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="搜索容器..."
                        className="w-full pl-7 pr-2 py-1 text-[11px] bg-secondary/50 rounded-md border border-transparent focus:border-primary/50 outline-none"
                    />
                </div>

                <button onClick={fetchContainers} className="p-1.5 hover:bg-secondary rounded transition-colors" title="刷新">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-3 mt-2 p-2.5 rounded-md bg-destructive/10 text-destructive text-[11px] flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
                </div>
            )}

            {/* Action Success */}
            {actionMsg && (
                <div className="mx-3 mt-2 p-2 rounded-md bg-green-500/10 text-green-500 text-[11px] font-mono">
                    {actionMsg}
                </div>
            )}

            {/* Compose Projects Banner */}
            {composeProjects.size > 0 && (
                <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                    {Array.from(composeProjects.entries()).map(([project, pContainers]) => {
                        const running = pContainers.filter(c => c.state?.toLowerCase() === 'running').length;
                        return (
                            <div key={project} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-mono">
                                <Layers className="w-3 h-3" />
                                {project}
                                <span className="opacity-60">{running}/{pContainers.length}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Container List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filtered.length === 0 && !loading && !error && (
                    <div className="text-center text-muted-foreground text-xs py-8 opacity-70">
                        <Container className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        未找到容器
                    </div>
                )}

                {filtered.map(container => (
                    <div key={container.id} className="bg-card/50 border border-border rounded-lg overflow-hidden hover:border-primary/30 transition-colors">
                        {/* Container Header */}
                        <div className="p-3">
                            <div className="flex items-start justify-between mb-1.5">
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-xs truncate flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${getStateColor(container.state)}`} />
                                        {container.name}
                                        {container.composeProject && (
                                            <span className="text-[9px] px-1.5 py-0 rounded bg-blue-500/10 text-blue-400 font-mono">
                                                {container.composeProject}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate mt-0.5 ml-4">{container.image}</div>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-2 whitespace-nowrap ${getStateBadge(container.state)}`}>
                                    {container.state || 'unknown'}
                                </span>
                            </div>

                            <div className="flex items-center justify-between mt-2">
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono">
                                    <span>{container.id.substring(0, 12)}</span>
                                    {container.ports && <span className="truncate max-w-[120px]" title={container.ports}>⇢ {container.ports}</span>}
                                </div>

                                <div className="flex items-center gap-0.5">
                                    {/* Logs */}
                                    <button
                                        onClick={() => setExpandedId(expandedId === container.id ? null : container.id)}
                                        className={`p-1 rounded transition-colors ${expandedId === container.id ? 'bg-primary/20 text-primary' : 'hover:bg-secondary text-muted-foreground'}`}
                                        title="日志"
                                    >
                                        <FileText className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Exec */}
                                    <button
                                        onClick={() => handleExec(container.id)}
                                        disabled={container.state?.toLowerCase() !== 'running'}
                                        className="p-1 hover:bg-purple-500/10 hover:text-purple-400 rounded disabled:opacity-20 transition-colors"
                                        title="进入容器"
                                    >
                                        <Terminal className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Start */}
                                    <button
                                        onClick={() => handleAction(container.id, 'start')}
                                        disabled={!!actionLoading || container.state?.toLowerCase() === 'running'}
                                        className="p-1 hover:bg-green-500/10 hover:text-green-500 rounded disabled:opacity-20 transition-colors"
                                        title="启动"
                                    >
                                        <Play className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Pause / Unpause */}
                                    {container.state?.toLowerCase() === 'paused' ? (
                                        <button
                                            onClick={() => handleAction(container.id, 'unpause')}
                                            disabled={!!actionLoading}
                                            className="p-1 hover:bg-yellow-500/10 hover:text-yellow-500 rounded disabled:opacity-20 transition-colors"
                                            title="恢复"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleAction(container.id, 'pause')}
                                            disabled={!!actionLoading || container.state?.toLowerCase() !== 'running'}
                                            className="p-1 hover:bg-yellow-500/10 hover:text-yellow-500 rounded disabled:opacity-20 transition-colors"
                                            title="暂停"
                                        >
                                            <Pause className="w-3.5 h-3.5" />
                                        </button>
                                    )}

                                    {/* Restart */}
                                    <button
                                        onClick={() => handleAction(container.id, 'restart')}
                                        disabled={!!actionLoading}
                                        className="p-1 hover:bg-blue-500/10 hover:text-blue-500 rounded disabled:opacity-20 transition-colors"
                                        title="重启"
                                    >
                                        <RotateCw className={`w-3.5 h-3.5 ${actionLoading === container.id ? 'animate-spin' : ''}`} />
                                    </button>

                                    {/* Stop */}
                                    <button
                                        onClick={() => handleAction(container.id, 'stop')}
                                        disabled={!!actionLoading || container.state?.toLowerCase() !== 'running'}
                                        className="p-1 hover:bg-red-500/10 hover:text-red-500 rounded disabled:opacity-20 transition-colors"
                                        title="停止"
                                    >
                                        <Square className="w-3.5 h-3.5 fill-current" />
                                    </button>

                                    {/* Delete */}
                                    {pendingConfirm === container.id ? (
                                        <>
                                            <button onClick={() => setPendingConfirm(null)} className="p-1 text-[10px] hover:bg-secondary rounded transition-colors text-muted-foreground">取消</button>
                                            <button onClick={() => { setPendingConfirm(null); handleAction(container.id, 'remove'); }} className="p-1 text-[10px] rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">确认</button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setPendingConfirm(container.id)}
                                            disabled={!!actionLoading}
                                            className="p-1 hover:bg-red-500/10 hover:text-red-500 rounded disabled:opacity-20 transition-colors"
                                            title="删除"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Expanded Logs */}
                        {expandedId === container.id && (
                            <LogViewer connectionId={connectionId} containerId={container.id} containerName={container.name} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// Log Viewer (inline expand)
// ═══════════════════════════════════════════════════════════
function LogViewer({ connectionId, containerId, containerName }: { connectionId: string; containerId: string; containerName: string }) {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const text = await (window as any).electron.dockerLogs(connectionId, containerId, 300);
            setLogs(text);
            setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
        } catch {
            setLogs('Failed to fetch logs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, [containerId]);

    const lines = logs.split('\n');
    const filteredLines = searchTerm
        ? lines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()))
        : lines;

    const highlightSearch = (line: string) => {
        if (!searchTerm) return line;
        const idx = line.toLowerCase().indexOf(searchTerm.toLowerCase());
        if (idx === -1) return line;
        return (
            <>
                {line.slice(0, idx)}
                <span className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">{line.slice(idx, idx + searchTerm.length)}</span>
                {line.slice(idx + searchTerm.length)}
            </>
        );
    };

    return (
        <div className="border-t border-border bg-background/80">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
                <FileText className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-mono">{containerName} 日志</span>
                <div className="flex-1 relative">
                    <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="搜索日志..."
                        className="w-full pl-6 pr-2 py-0.5 text-[10px] bg-secondary/50 rounded border border-transparent focus:border-primary/50 outline-none"
                    />
                </div>
                <button onClick={fetchLogs} className="p-1 hover:bg-secondary rounded">
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
            <div ref={logRef} className="h-[200px] overflow-y-auto p-2 font-mono text-[10px] leading-[1.6] text-muted-foreground scrollbar-hide">
                {filteredLines.map((line, i) => (
                    <div key={i} className="hover:bg-muted/30 px-1 whitespace-pre-wrap break-all">
                        {highlightSearch(line)}
                    </div>
                ))}
                {loading && <div className="text-center text-muted-foreground/50 py-4 animate-pulse">加载中...</div>}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// Images Tab
// ═══════════════════════════════════════════════════════════
function ImagesTab({ connectionId }: { connectionId: string }) {
    const [images, setImages] = useState<DockerImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchImages = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await (window as any).electron.dockerImages(connectionId);
            setImages(list);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchImages(); }, [connectionId]);

    const handleDelete = async (imageId: string) => {
        setDeleting(imageId);
        try {
            await (window as any).electron.dockerRemoveImage(connectionId, imageId);
            await fetchImages();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="p-3 flex items-center justify-between border-b border-border/50">
                <div className="flex items-center gap-2 text-xs">
                    <Package className="w-4 h-4 text-blue-400" />
                    <span className="font-medium">镜像</span>
                    <span className="text-muted-foreground bg-secondary px-1.5 rounded-full text-[10px]">{images.length}</span>
                </div>
                <button onClick={fetchImages} className="p-1.5 hover:bg-secondary rounded transition-colors">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="mx-3 mt-2 p-2 rounded-md bg-destructive/10 text-destructive text-[11px] flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" /> {error}
                </div>
            )}

            <div className="flex-1 overflow-y-auto">
                {/* Table Header */}
                <div className="grid grid-cols-[1fr_80px_80px_80px_40px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 border-b border-border/30 sticky top-0 bg-background/80 backdrop-blur-sm">
                    <span>仓库:标签</span>
                    <span>大小</span>
                    <span>创建时间</span>
                    <span>ID</span>
                    <span></span>
                </div>

                {images.map(img => (
                    <div key={img.id} className="grid grid-cols-[1fr_80px_80px_80px_40px] gap-2 px-3 py-2 text-[11px] border-b border-border/20 hover:bg-muted/30 items-center">
                        <span className="font-mono truncate text-foreground/80">
                            {img.repository}<span className="text-muted-foreground">:{img.tag}</span>
                        </span>
                        <span className="text-muted-foreground font-mono">{img.size}</span>
                        <span className="text-muted-foreground truncate">{img.created}</span>
                        <span className="text-muted-foreground/50 font-mono">{img.id.substring(0, 12)}</span>
                        <button
                            onClick={() => handleDelete(img.id)}
                            disabled={!!deleting}
                            className="p-1 hover:bg-red-500/10 hover:text-red-500 rounded disabled:opacity-20 transition-colors"
                        >
                            <Trash2 className={`w-3 h-3 ${deleting === img.id ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                ))}

                {images.length === 0 && !loading && (
                    <div className="text-center text-muted-foreground text-xs py-8 opacity-70">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        未找到镜像
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// Prune Tab
// ═══════════════════════════════════════════════════════════
function PruneTab({ connectionId }: { connectionId: string }) {
    const [diskUsage, setDiskUsage] = useState('');
    const [loading, setLoading] = useState(false);
    const [pruneResult, setPruneResult] = useState<string | null>(null);
    const [pruning, setPruning] = useState<string | null>(null);

    const fetchDiskUsage = async () => {
        setLoading(true);
        try {
            const text = await (window as any).electron.dockerDiskUsage(connectionId);
            setDiskUsage(text);
        } catch {
            setDiskUsage('Failed to get disk usage');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDiskUsage(); }, [connectionId]);

    const handlePrune = async (type: string, label: string) => {
        setPruning(type);
        setPruneResult(null);
        try {
            const result = await (window as any).electron.dockerPrune(connectionId, type);
            setPruneResult(result);
            await fetchDiskUsage();
        } catch (err: any) {
            setPruneResult(`错误: ${err.message}`);
        } finally {
            setPruning(null);
        }
    };

    const pruneActions = [
        { type: 'containers', label: '清理已停止的容器', icon: Container, color: 'text-orange-400 hover:bg-orange-500/10', desc: 'docker container prune' },
        { type: 'images', label: '清理无用镜像', icon: Package, color: 'text-blue-400 hover:bg-blue-500/10', desc: 'docker image prune -a' },
        { type: 'volumes', label: '清理悬空数据卷', icon: HardDrive, color: 'text-purple-400 hover:bg-purple-500/10', desc: 'docker volume prune' },
        { type: 'system', label: '全面清理 (System Prune)', icon: Trash2, color: 'text-red-400 hover:bg-red-500/10', desc: 'docker system prune -af --volumes' },
    ];

    return (
        <div className="h-full flex flex-col">
            {/* Disk Usage */}
            <div className="p-3 border-b border-border/50">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <HardDrive className="w-4 h-4 text-amber-400" />
                        磁盘使用
                    </div>
                    <button onClick={fetchDiskUsage} className="p-1 hover:bg-secondary rounded">
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <pre className="text-[10px] font-mono text-muted-foreground bg-secondary/30 rounded-md p-2 overflow-x-auto whitespace-pre leading-[1.5]">
                    {diskUsage || '加载中...'}
                </pre>
            </div>

            {/* Prune Actions */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {pruneActions.map(action => (
                    <button
                        key={action.type}
                        onClick={() => handlePrune(action.type, action.label)}
                        disabled={!!pruning}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-all ${action.color} disabled:opacity-40`}
                    >
                        <action.icon className={`w-5 h-5 shrink-0 ${pruning === action.type ? 'animate-spin' : ''}`} />
                        <div className="text-left min-w-0">
                            <div className="text-xs font-medium">{action.label}</div>
                            <div className="text-[10px] text-muted-foreground/60 font-mono">{action.desc}</div>
                        </div>
                    </button>
                ))}
            </div>

            {/* Prune Result */}
            {pruneResult && (
                <div className="border-t border-border p-3">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-medium text-muted-foreground">清理结果</span>
                        <button onClick={() => setPruneResult(null)} className="p-0.5 hover:bg-secondary rounded">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                    <pre className="text-[10px] font-mono text-green-400/80 bg-secondary/30 rounded-md p-2 overflow-x-auto whitespace-pre max-h-[150px] overflow-y-auto leading-[1.5]">
                        {pruneResult}
                    </pre>
                </div>
            )}
        </div>
    );
}
