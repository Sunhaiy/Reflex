import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Bookmark01Icon, Cancel01Icon, Delete02Icon, Download01Icon, FileAddIcon, FolderAddIcon, FolderOpenIcon, PencilIcon, Refresh01Icon, Search01Icon, StarIcon, Upload01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileEntry } from '../../shared/types';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../store/settingsStore';
import { useTranslation } from '../../hooks/useTranslation';
import { FileBreadcrumb } from './FileBreadcrumb';

interface Props {
    currentPath: string;
    loading: boolean;
    isCompact: boolean;
    selectedFile: FileEntry | null;
    fileCount: number;
    filterQuery: string;
    onFilterChange: (value: string) => void;
    onUp: () => void;
    onHome: () => void;
    onRefresh: () => void;
    onUpload: (file?: File) => void;
    onNavigate: (path: string) => void;
    onNewFolder: () => void;
    onNewFile: () => void;
    onOpenSelected: () => void;
    onDownloadSelected: () => void;
    onRenameSelected: () => void;
    onDeleteSelected: () => void;
}

const iconButtonClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/25';
const actionButtonClass = 'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/25';

export function FileToolbar({
    currentPath,
    loading,
    isCompact,
    selectedFile,
    fileCount,
    filterQuery,
    onFilterChange,
    onUp,
    onHome,
    onRefresh,
    onUpload,
    onNavigate,
    onNewFolder,
    onNewFile,
    onOpenSelected,
    onDownloadSelected,
    onRenameSelected,
    onDeleteSelected,
}: Props) {
    const { t, language } = useTranslation();
    const { bookmarks, toggleBookmark } = useSettingsStore();
    const [showBookmarks, setShowBookmarks] = useState(false);
    const bookmarkButtonRef = useRef<HTMLButtonElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isBookmarked = bookmarks.includes(currentPath);

    const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) onUpload(file);
        event.target.value = '';
    };

    return (
        <div className="shrink-0 space-y-1.5 p-2 pb-1.5">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />

            <div className="flex h-9 min-w-0 items-center gap-1.5">
                <div className="flex shrink-0 items-center rounded-xl bg-foreground/[0.035] p-0.5">
                    <button onClick={onUp} className={iconButtonClass} title={t('fileBrowser.upLevel')}>
                        <HugeiconsIcon icon={ArrowUp01Icon} className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onHome} className={iconButtonClass} title={t('fileBrowser.home')}>
                        <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={onRefresh} className={iconButtonClass} title={t('fileBrowser.refresh')}>
                        <HugeiconsIcon icon={Refresh01Icon} className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                    </button>
                </div>

                <div className="flex h-8 min-w-0 flex-1 items-center rounded-xl border border-border/60 bg-background/45 px-1">
                    <FileBreadcrumb currentPath={currentPath} onNavigate={onNavigate} />
                </div>

                <div className="flex shrink-0 items-center rounded-xl bg-foreground/[0.035] p-0.5">
                    <button
                        onClick={() => toggleBookmark(currentPath)}
                        className={cn(iconButtonClass, isBookmarked && 'bg-foreground/[0.09] text-foreground')}
                        title={t('fileBrowser.bookmark')}
                    >
                        <HugeiconsIcon icon={StarIcon} className={cn('h-3.5 w-3.5', isBookmarked && 'fill-current')} />
                    </button>
                    <button
                        ref={bookmarkButtonRef}
                        onClick={() => setShowBookmarks((value) => !value)}
                        className={cn(iconButtonClass, showBookmarks && 'bg-foreground/[0.09] text-foreground')}
                        title={t('fileBrowser.bookmarkList')}
                    >
                        <HugeiconsIcon icon={Bookmark01Icon} className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className={iconButtonClass} title={t('fileBrowser.uploadFile')}>
                        <HugeiconsIcon icon={Upload01Icon} className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex h-8 min-w-0 items-center gap-1.5">
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/[0.035] px-2.5 text-muted-foreground focus-within:bg-foreground/[0.055] focus-within:text-foreground">
                    <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5 shrink-0" />
                    <input
                        value={filterQuery}
                        onChange={(event) => onFilterChange(event.target.value)}
                        placeholder={t('fileBrowser.search')}
                        className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/65"
                    />
                    {filterQuery && (
                        <button type="button" onClick={() => onFilterChange('')} className="rounded-md p-0.5 hover:bg-foreground/10">
                            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                        </button>
                    )}
                </label>

                {!isCompact && (
                    <span className="shrink-0 px-1 text-[9px] tabular-nums text-muted-foreground/65">
                        {fileCount} {language === 'zh' ? '项' : 'items'}
                    </span>
                )}
                <div className="flex shrink-0 items-center rounded-xl bg-foreground/[0.035] p-0.5">
                    <button className={iconButtonClass} onClick={onNewFolder} title={t('fileBrowser.newFolder')}>
                        <HugeiconsIcon icon={FolderAddIcon} className="h-3.5 w-3.5" />
                    </button>
                    <button className={iconButtonClass} onClick={onNewFile} title={t('fileBrowser.newFile')}>
                        <HugeiconsIcon icon={FileAddIcon} className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {selectedFile && (
                <div className="flex min-h-8 min-w-0 items-center gap-1 rounded-xl bg-foreground/[0.045] px-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate px-1.5 text-[10px] font-medium text-foreground/85" title={selectedFile.name}>
                        {selectedFile.name}
                    </span>
                    <button className={actionButtonClass} onClick={onOpenSelected}>
                        {selectedFile.type === 'd'
                            ? <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
                            : <HugeiconsIcon icon={ViewIcon} className="h-3.5 w-3.5" />}
                        {!isCompact && <span>{t(selectedFile.type === 'd' ? 'fileBrowser.open' : 'fileBrowser.preview')}</span>}
                    </button>
                    {selectedFile.type !== 'd' && (
                        <button className={actionButtonClass} onClick={onDownloadSelected} title={t('fileBrowser.download')}>
                            <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <button className={actionButtonClass} onClick={onRenameSelected} title={t('fileBrowser.rename')}>
                        <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                    </button>
                    <button className={cn(actionButtonClass, 'hover:bg-destructive/10 hover:text-destructive')} onClick={onDeleteSelected} title={t('fileBrowser.delete')}>
                        <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {showBookmarks && createPortal(
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowBookmarks(false)} />
                    <div
                        className="fixed z-50 w-60 rounded-xl border border-border/70 bg-popover p-1.5 shadow-2xl animate-in fade-in zoom-in-95"
                        style={(() => {
                            const rect = bookmarkButtonRef.current?.getBoundingClientRect();
                            return rect
                                ? { top: rect.bottom + 6, left: Math.max(6, rect.right - 240) }
                                : { top: 48, left: 8 };
                        })()}
                    >
                        <div className="px-2 py-2 text-[10px] font-semibold text-muted-foreground">{t('fileBrowser.favorites')}</div>
                        {bookmarks.length === 0 ? (
                            <div className="px-2 py-5 text-center text-xs text-muted-foreground">{t('fileBrowser.noBookmarks')}</div>
                        ) : bookmarks.map((path) => (
                            <div
                                key={path}
                                className="group/item flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-foreground/[0.06]"
                                onClick={() => { onNavigate(path); setShowBookmarks(false); }}
                            >
                                <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">{path}</span>
                                <button
                                    onClick={(event) => { event.stopPropagation(); toggleBookmark(path); }}
                                    className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground group-hover/item:opacity-100"
                                >
                                    <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </>,
                document.body,
            )}
        </div>
    );
}
