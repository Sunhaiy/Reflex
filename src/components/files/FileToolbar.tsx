import { ArrowUp, RefreshCw, Upload, Star, Bookmark, X, FolderOpen } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../store/settingsStore';
import { useTranslation } from '../../hooks/useTranslation';
import { FileBreadcrumb } from './FileBreadcrumb';

interface Props {
    currentPath: string;
    loading: boolean;
    onUp: () => void;
    onHome: () => void;
    onRefresh: () => void;
    onUpload: (file?: File) => void;
    onNavigate: (path: string) => void;
}

export function FileToolbar({ currentPath, loading, onUp, onHome, onRefresh, onUpload, onNavigate }: Props) {
    const { t } = useTranslation();
    const { bookmarks, toggleBookmark } = useSettingsStore();
    const [showBookmarks, setShowBookmarks] = useState(false);
    const bmBtnRef = useRef<HTMLButtonElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isBookmarked = bookmarks.includes(currentPath);

    const btn = 'p-1.5 rounded-md transition-colors focus:outline-none text-muted-foreground hover:bg-accent hover:text-accent-foreground';

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onUpload(file);
            // Reset so the same file can be re-uploaded
            e.target.value = '';
        }
    };

    return (
        <div className="border-b border-border flex flex-col bg-transparent shrink-0">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
            />

            {/* Row 1: Nav controls */}
            <div className="h-9 flex items-center gap-0.5 px-2">
                <button onClick={onUp} className={btn} title={t('fileBrowser.upLevel')}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button onClick={onRefresh} className={btn} title={t('fileBrowser.refresh')}>
                    <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                </button>
                <button onClick={onHome} className={btn} title={t('fileBrowser.home')}>
                    <FolderOpen className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1 shrink-0" />
                <button
                    onClick={() => toggleBookmark(currentPath)}
                    className={cn(btn, isBookmarked ? 'text-yellow-500 hover:bg-yellow-500/10' : '')}
                    title={t('fileBrowser.bookmark')}
                >
                    <Star className={cn('w-3.5 h-3.5', isBookmarked && 'fill-current')} />
                </button>
                <div className="relative">
                    <button
                        ref={bmBtnRef}
                        onClick={() => setShowBookmarks(v => !v)}
                        className={cn(btn, showBookmarks && 'bg-accent text-accent-foreground')}
                        title={t('fileBrowser.bookmarkList')}
                    >
                        <Bookmark className="w-3.5 h-3.5" />
                    </button>
                    {showBookmarks && createPortal(
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowBookmarks(false)} />
                            <div
                                className="fixed z-50 w-56 bg-popover border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95"
                                style={(() => {
                                    const r = bmBtnRef.current?.getBoundingClientRect();
                                    return r ? { top: r.bottom + 4, left: Math.max(4, r.right - 224) } : { top: 40, left: 10 };
                                })()}
                            >
                                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border mb-1">{t('fileBrowser.favorites')}</div>
                                {bookmarks.length === 0
                                    ? <div className="px-3 py-4 text-center text-xs text-muted-foreground italic">{t('fileBrowser.noBookmarks')}</div>
                                    : bookmarks.map(p => (
                                        <div
                                            key={p}
                                            className="px-3 py-2 hover:bg-accent hover:text-accent-foreground cursor-pointer text-xs flex justify-between items-center group/item mx-1 rounded-md transition-colors"
                                            onClick={() => { onNavigate(p); setShowBookmarks(false); }}
                                        >
                                            <span className="truncate flex-1">{p}</span>
                                            <button
                                                onClick={e => { e.stopPropagation(); toggleBookmark(p); }}
                                                className="opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-destructive p-0.5 rounded transition-opacity"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </>,
                        document.body
                    )}
                </div>
                <div className="flex-1" />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(btn, 'flex items-center gap-1 text-xs px-2')}
                    title={t('fileBrowser.uploadFile')}
                >
                    <Upload className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t('fileBrowser.upload')}</span>
                </button>
            </div>
            {/* Row 2: Breadcrumb */}
            <div className="h-8 flex items-center px-2 border-t border-border/30">
                <FileBreadcrumb currentPath={currentPath} onNavigate={onNavigate} />
            </div>
        </div>
    );
}
