import { useState } from 'react';
import { Monitor, Container, Rocket } from 'lucide-react';
import { PanelSlotConsumer } from './PanelSlot';

interface RightPanelProps {
    connectionId: string;
    isConnected?: boolean;
    isActive?: boolean;
}

export function RightPanel({ connectionId, isConnected = true, isActive = true }: RightPanelProps) {
    const [activeTab, setActiveTab] = useState<'monitor' | 'docker' | 'deploy'>('monitor');

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Tabs */}
            <div className="flex items-center border-b border-border bg-muted/40 text-xs overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('monitor')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-muted/30 whitespace-nowrap ${activeTab === 'monitor'
                        ? 'bg-transparent text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Monitor className="w-3.5 h-3.5" />
                    Monitor
                </button>
                <button
                    onClick={() => setActiveTab('docker')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-muted/30 whitespace-nowrap ${activeTab === 'docker'
                        ? 'bg-transparent text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Container className="w-3.5 h-3.5" />
                    Docker
                </button>
                <button
                    onClick={() => setActiveTab('deploy')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-muted/30 whitespace-nowrap ${activeTab === 'deploy'
                        ? 'bg-transparent text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Rocket className="w-3.5 h-3.5" />
                    Deploy
                </button>
            </div>

            {/* Content — shared panel instances via PanelSlotConsumer */}
            <div className="flex-1 overflow-hidden relative">
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'monitor' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <PanelSlotConsumer panel="monitor" active={isActive} />
                </div>
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'docker' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <PanelSlotConsumer panel="docker" active={isActive} />
                </div>
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'deploy' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <PanelSlotConsumer panel="deploy" active={isActive} />
                </div>
            </div>
        </div>
    );
}
