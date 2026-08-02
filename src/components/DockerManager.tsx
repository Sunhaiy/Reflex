import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ContainerIcon, Delete02Icon, PackageIcon } from "@hugeicons/core-free-icons";
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { ContainersTab } from './docker/ContainersTab';
import { ImagesTab } from './docker/ImagesTab';
import { PruneTab } from './docker/PruneTab';
import type { DockerTabId } from './docker/types';

interface DockerManagerProps {
    connectionId: string;
}

export function DockerManager({ connectionId }: DockerManagerProps) {
    const [tab, setTab] = useState<DockerTabId>('containers');
    const { t } = useTranslation();

    const tabs: { id: DockerTabId; label: string; icon: IconSvgElement }[] = [
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
