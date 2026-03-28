import { useState } from 'react';
import { Monitor, Container } from 'lucide-react';
import { PanelSlotConsumer } from './PanelSlot';
import { useTranslation } from '../hooks/useTranslation';

interface RightPanelProps {
    connectionId: string;
    isConnected?: boolean;
    isActive?: boolean;
}

export function RightPanel({ connectionId: _connectionId, isConnected: _isConnected = true, isActive = true }: RightPanelProps) {
    const [activeTab, setActiveTab] = useState<'monitor' | 'docker'>('monitor');
    const { t } = useTranslation();

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="flex items-center border-b border-border bg-muted/40 text-xs overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('monitor')}
                    className={`flex items-center gap-2 px-3 py-2 border-r border-border transition-colors hover:bg-muted/30 whitespace-nowrap ${activeTab === 'monitor'
                        ? 'bg-transparent text-foreground font-medium border-b-2 border-b-primary -mb-[1px]'
                        : 'text-muted-foreground'
                        }`}
                >
                    <Monitor className="w-3.5 h-3.5" />
                    {t('processList.title')}
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
            </div>

            <div className="flex-1 overflow-hidden relative">
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'monitor' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <PanelSlotConsumer panel="monitor" active={isActive} />
                </div>
                <div className={`absolute inset-0 transition-opacity duration-200 ${activeTab === 'docker' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <PanelSlotConsumer panel="docker" active={isActive} />
                </div>
            </div>
        </div>
    );
}
