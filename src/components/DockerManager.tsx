import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ContainerIcon, Delete02Icon, Loading02Icon, PackageIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { ContainersTab } from './docker/ContainersTab';
import { ImagesTab } from './docker/ImagesTab';
import { PruneTab } from './docker/PruneTab';
import type { DockerTabId } from './docker/types';

interface DockerManagerProps {
    connectionId: string;
    active: boolean;
}

export function DockerManager({ connectionId, active }: DockerManagerProps) {
    const [tab, setTab] = useState<DockerTabId>('containers');
    const [available, setAvailable] = useState<boolean | null>(null);
    const { t } = useTranslation();

    const checkAvailability = async () => {
        setAvailable(null);
        const result = await window.electron.isDockerAvailable(connectionId).catch(() => false);
        setAvailable(result);
    };

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setAvailable(null);
        void window.electron.isDockerAvailable(connectionId)
            .then((result) => {
                if (!cancelled) setAvailable(result);
            })
            .catch(() => {
                if (!cancelled) setAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, [active, connectionId]);

    const tabs: { id: DockerTabId; label: string; icon: IconSvgElement }[] = [
        { id: 'containers', label: t('docker.containers'), icon: ContainerIcon },
        { id: 'images', label: t('docker.images'), icon: PackageIcon },
        { id: 'prune', label: t('docker.prune'), icon: Delete02Icon },
    ];

    if (available !== true) {
        return (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                {available === null ? (
                    <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                    <>
                        <HugeiconsIcon icon={ContainerIcon} className="h-6 w-6 text-muted-foreground/65" />
                        <p className="mt-3 text-xs font-medium">{t('docker.noDocker')}</p>
                        <p className="mt-1 max-w-xs text-[11px] leading-5 text-muted-foreground">
                            {t('docker.noDockerHint')}
                        </p>
                        <button
                            type="button"
                            onClick={() => void checkAvailability()}
                            className="mt-3 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        >
                            <HugeiconsIcon icon={Refresh01Icon} className="h-3.5 w-3.5" />
                            {t('common.refresh')}
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-transparent text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
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
                {tab === 'containers' && <ContainersTab connectionId={connectionId} active={active} />}
                {tab === 'images' && <ImagesTab connectionId={connectionId} active={active} />}
                {tab === 'prune' && <PruneTab connectionId={connectionId} active={active} />}
            </div>
        </div>
    );
}
