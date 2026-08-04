import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Cancel01Icon, Delete02Icon, PackageIcon, Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import type { DockerImage } from '../../shared/types';
import type { DockerTabProps } from './types';
import { errorMessage } from '../../lib/errors';
import { DockerCardsSkeleton } from '../ui/skeleton';

const CARD_REVEAL = [
    'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1',
    'motion-safe:duration-300 fill-mode-backwards',
].join(' ');

export function ImagesTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [images, setImages] = useState<DockerImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
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
        } catch (err) {
            setError(errorMessage(err, t('common.error')));
        } finally {
            setHasLoaded(true);
            setLoading(false);
        }
    };

    useEffect(() => {
        setImages([]);
        setHasLoaded(false);
        fetchImages();
    }, [connectionId]);

    const handleDelete = async (imageId: string) => {
        setPendingDelete(null);
        setDeleting(imageId);
        try {
            await window.electron.dockerRemoveImage(connectionId, imageId);
            await fetchImages();
        } catch (err) {
            setError(errorMessage(err, t('common.error')));
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

            <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-busy={!hasLoaded || loading}>
                {!hasLoaded && <DockerCardsSkeleton />}

                {filteredImages.map((image, index) => (
                    <div
                        key={image.id}
                        className={cn(
                            'rounded-xl border border-border/65 bg-background/24 p-3 transition-colors hover:border-foreground/20',
                            CARD_REVEAL,
                        )}
                        style={{
                            animationDelay: `${Math.min(index, 6) * 35}ms`,
                            animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                    >
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
