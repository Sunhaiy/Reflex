import { useEffect, useState } from 'react';
import { RefreshCw, Play, Square, RotateCw, FileCode, Container, AlertCircle } from 'lucide-react';

interface Container {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string; // 'running', 'exited', etc.
}

interface DockerManagerProps {
    connectionId: string;
}

export function DockerManager({ connectionId }: DockerManagerProps) {
    const [containers, setContainers] = useState<Container[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchContainers = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await window.electron.getDockerContainers(connectionId);
            setContainers(list);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch containers');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = setInterval(fetchContainers, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [connectionId]);

    const handleAction = async (containerId: string, action: 'start' | 'stop' | 'restart') => {
        setActionLoading(containerId);
        try {
            await window.electron.dockerAction(connectionId, containerId, action);
            fetchContainers();
        } catch (err: any) {
            alert(`Failed to ${action} container: ` + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    const getStatusColor = (state: string) => {
        if (state.toLowerCase().includes('running')) return 'bg-green-500';
        if (state.toLowerCase().includes('exited')) return 'bg-muted-foreground';
        return 'bg-yellow-500';
    };

    return (
        <div className="h-full flex flex-col bg-transparent text-foreground">
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                    <Container className="w-4 h-4 text-blue-500" />
                    <span>Containers</span>
                    <span className="text-xs bg-secondary px-2 rounded-full">{containers.length}</span>
                </div>
                <button onClick={fetchContainers} className="p-1.5 hover:bg-secondary rounded transition-colors" title="Refresh">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {error && (
                    <div className="p-4 rounded bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {containers.length === 0 && !loading && !error && (
                    <div className="text-center text-muted-foreground text-sm py-8 opacity-70">
                        No containers found
                    </div>
                )}

                {containers.map(container => (
                    <div key={container.id} className="bg-card/50 border border-border rounded-lg p-3 shadow-none hover:border-primary/50 transition-colors">
                        <div className="flex items-start justify-between mb-2">
                            <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm truncate flex items-center gap-2" title={container.name}>
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusColor(container.status)}`} />
                                    {container.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate opacity-80 mt-0.5" title={container.image}>
                                    {container.image}
                                </div>
                            </div>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-2 whitespace-nowrap ${container.status.toLowerCase().includes('up')
                                    ? 'bg-green-500/15 text-green-500'
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                {container.state || (container.status.toLowerCase().includes('up') ? 'running' : 'exited')}
                            </span>
                        </div>

                        <div className="text-[11px] text-muted-foreground mb-2 truncate" title={container.status}>
                            {container.status}
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground/60">
                                {container.id.substring(0, 12)}
                            </span>

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => handleAction(container.id, 'start')}
                                    disabled={!!actionLoading || container.status.toLowerCase().includes('up')}
                                    className="p-1.5 hover:bg-green-500/10 hover:text-green-500 rounded disabled:opacity-30 transition-colors"
                                    title="Start"
                                >
                                    <Play className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => handleAction(container.id, 'restart')}
                                    disabled={!!actionLoading}
                                    className="p-1.5 hover:bg-blue-500/10 hover:text-blue-500 rounded disabled:opacity-30 transition-colors"
                                    title="Restart"
                                >
                                    <RotateCw className={`w-3.5 h-3.5 ${actionLoading === container.id ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                    onClick={() => handleAction(container.id, 'stop')}
                                    disabled={!!actionLoading || !container.status.toLowerCase().includes('up')}
                                    className="p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded disabled:opacity-30 transition-colors"
                                    title="Stop"
                                >
                                    <Square className="w-3.5 h-3.5 fill-current" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
