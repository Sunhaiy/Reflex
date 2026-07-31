import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { memo, useEffect, useRef, useState } from 'react';
import { FileEntry } from '../../shared/types';
import { FlowingBar } from '../ui/progress-bar';
import { FileListSkeleton } from '../ui/skeleton';
import { FileItem } from './FileItem';
import { useTranslation } from '../../hooks/useTranslation';

type SortField = 'name' | 'size' | 'date';
type SortOrder = 'asc' | 'desc';

interface Props {
    files: FileEntry[];
    loading: boolean;
    hasLoaded: boolean;
    sortField: SortField;
    sortOrder: SortOrder;
    filterQuery: string;
    selectedName: string | null;
    onToggleSort: (f: SortField) => void;
    onFileClick: (file: FileEntry) => void;
    onFileDoubleClick: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

function SortIcon({ field, sortField, sortOrder }: { field: SortField; sortField: SortField; sortOrder: SortOrder }) {
    if (sortField !== field) return <span className="w-3 h-3 inline-block" />;
    return sortOrder === 'asc'
        ? <HugeiconsIcon icon={ArrowUp01Icon} className="w-3 h-3 inline-block" />
        : <HugeiconsIcon icon={ArrowDown01Icon} className="w-3 h-3 inline-block" />;
}

function sortFiles(files: FileEntry[], field: SortField, order: SortOrder, query: string): FileEntry[] {
    let result = files;
    if (query) {
        const q = query.toLowerCase();
        result = result.filter(f => f.name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'd' ? -1 : 1;
        let cmp = 0;
        if (field === 'name') cmp = a.name.localeCompare(b.name);
        else if (field === 'size') cmp = a.size - b.size;
        else if (field === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
        return order === 'asc' ? cmp : -cmp;
    });
}

/**
 * Most listings finish in a few milliseconds now that the SFTP session is reused, so the
 * bar only appears once loading is actually slow — otherwise it strobes on every click.
 */
function useDelayedBusy(active: boolean, delay = 160, minVisible = 300) {
    const [visible, setVisible] = useState(false);
    const shownAtRef = useRef(0);

    useEffect(() => {
        if (active) {
            if (visible) return;
            const timer = window.setTimeout(() => {
                shownAtRef.current = Date.now();
                setVisible(true);
            }, delay);
            return () => window.clearTimeout(timer);
        }

        if (!visible) return;
        const remaining = Math.max(0, minVisible - (Date.now() - shownAtRef.current));
        const timer = window.setTimeout(() => setVisible(false), remaining);
        return () => window.clearTimeout(timer);
    }, [active, delay, minVisible, visible]);

    return visible;
}

export const FileList = memo(function FileList({
    files, loading, hasLoaded, sortField, sortOrder, filterQuery, selectedName,
    onToggleSort, onFileClick, onFileDoubleClick, onContextMenu,
}: Props) {
    const { t } = useTranslation();
    const busy = useDelayedBusy(loading || !hasLoaded);
    const sorted = sortFiles(files, sortField, sortOrder, filterQuery);
    const hdrCls = 'flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors select-none';

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden" aria-busy={loading || !hasLoaded}>
            {/* Header */}
            <div className="mx-1 mb-1 grid shrink-0 grid-cols-[24px_minmax(0,1fr)] items-center rounded-lg bg-foreground/[0.035] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div />
                <div className={`min-w-0 pl-1 ${hdrCls}`} onClick={() => onToggleSort('name')}>
                    {t('fileBrowser.name')} <SortIcon field="name" sortField={sortField} sortOrder={sortOrder} />
                </div>
            </div>

            {/* Body */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
                {/* First load has nothing to show yet, so the skeleton stands in for the list. */}
                {!hasLoaded ? (
                    <FileListSkeleton />
                ) : (
                <>
                <div className="absolute inset-x-0 top-0 z-10 h-[2px]">
                    {busy && <FlowingBar className="animate-in fade-in duration-150" />}
                </div>
                <div className="h-full space-y-0.5 overflow-y-auto overflow-x-hidden overscroll-contain pb-2 [scrollbar-gutter:stable]">
                    {(sorted.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground/50">
                            <HugeiconsIcon icon={Folder01Icon} className="h-10 w-10 opacity-30" />
                            <p className="text-xs">{filterQuery ? t('fileBrowser.noMatches') : t('fileBrowser.emptyFolder')}</p>
                        </div>
                    ) : (
                        sorted.map((file) => (
                            <FileItem
                                key={file.name}
                                file={file}
                                isSelected={selectedName === file.name}
                                onClick={onFileClick}
                                onDoubleClick={onFileDoubleClick}
                                onContextMenu={onContextMenu}
                            />
                        ))
                    ))}
                </div>
                </>
                )}
            </div>
        </div>
    );
});
