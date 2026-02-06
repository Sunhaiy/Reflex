import { useState } from 'react';
import { SystemMonitor } from './SystemMonitor';
import { DockerManager } from './DockerManager';
import { TunnelManager } from './TunnelManager';
import { Monitor, Container, Network } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';

interface RightPanelProps {
    connectionId: string;
}

export function RightPanel({ connectionId }: RightPanelProps) {
    const [activeTab, setActiveTab] = useState<'monitor' | 'docker' | 'tunnels'>('monitor');

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Tabs */}
            <div className="flex items-center border-b border-border bg-muted/40 text-xs overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('monitor')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-background whitespace-nowrap ${activeTab === 'monitor'
                        ? 'bg-background text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Monitor className="w-3.5 h-3.5" />
                    Monitor
                </button>
                <button
                    onClick={() => setActiveTab('docker')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-background whitespace-nowrap ${activeTab === 'docker'
                        ? 'bg-background text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Container className="w-3.5 h-3.5" />
                    Docker
                </button>
                <button
                    onClick={() => setActiveTab('tunnels')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-background whitespace-nowrap ${activeTab === 'tunnels'
                        ? 'bg-background text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Network className="w-3.5 h-3.5" />
                    Tunnels
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'monitor' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <ErrorBoundary name="SystemMonitor">
                        <SystemMonitor connectionId={connectionId} />
                    </ErrorBoundary>
                </div>
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'docker' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <ErrorBoundary name="DockerManager">
                        {activeTab === 'docker' && <DockerManager connectionId={connectionId} />}
                    </ErrorBoundary>
                </div>
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'tunnels' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <ErrorBoundary name="TunnelManager">
                        {activeTab === 'tunnels' && <TunnelManager connectionId={connectionId} />}
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
