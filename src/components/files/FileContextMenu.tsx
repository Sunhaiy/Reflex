import { createPortal } from 'react-dom';
import { FileEntry } from '../../shared/types';
import { Download, Edit2, Trash2, FolderPlus, Plus, RefreshCw, Pencil } from 'lucide-react';
import { useTranslation } from '../../hooks/useTranslation';

interface Props {
    x: number;
    y: number;
    file: FileEntry | null; // null = background click
    onClose: () => void;
    onDownload: (file: FileEntry) => void;
    onOpen: (file: FileEntry) => void;
    onRename: (file: FileEntry) => void;
    onDelete: (file: FileEntry) => void;
    onNewFolder: () => void;
    onNewFile: () => void;
    onRefresh: () => void;
}

const item = 'w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors';
const danger = 'w-full text-left px-3 py-2 text-destructive hover:bg-destructive/10 text-xs flex items-center gap-2 transition-colors';
const sep = 'h-px bg-border/50 my-1 mx-2';

export function FileContextMenu({
    x, y, file, onClose, onDownload, onOpen, onRename, onDelete, onNewFolder, onNewFile, onRefresh,
}: Props) {
    const { t } = useTranslation();
    // Clamp to viewport edges
    const menuW = 192, menuH = file ? 160 : 120;
    const left = Math.min(x, window.innerWidth - menuW - 8);
    const top = Math.min(y, window.innerHeight - menuH - 8);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
            <div
                className="fixed z-50 w-48 bg-popover border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95"
                style={{ top, left }}
                onClick={onClose}
            >
                {/* Label */}
                <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border/50 mb-1 truncate mx-1">
                    {file ? file.name : t('fileBrowser.currentDir')}
                </div>

                {file ? (
                    <>
                        {file.type === '-' && (
                            <button className={item} onClick={() => onOpen(file)}>
                                <Edit2 className="w-3.5 h-3.5" /> {t('fileBrowser.openEditor')}
                            </button>
                        )}
                        <button className={item} onClick={() => onDownload(file)}>
                            <Download className="w-3.5 h-3.5" /> {t('fileBrowser.download')}
                        </button>
                        <button className={item} onClick={() => onRename(file)}>
                            <Pencil className="w-3.5 h-3.5" /> {t('fileBrowser.rename')}
                        </button>
                        <div className={sep} />
                        <button className={danger} onClick={() => onDelete(file)}>
                            <Trash2 className="w-3.5 h-3.5" /> {t('fileBrowser.delete')}
                        </button>
                    </>
                ) : (
                    <>
                        <button className={item} onClick={onNewFolder}>
                            <FolderPlus className="w-3.5 h-3.5" /> {t('fileBrowser.newFolder')}
                        </button>
                        <button className={item} onClick={onNewFile}>
                            <Plus className="w-3.5 h-3.5" /> {t('fileBrowser.newFile')}
                        </button>
                        <div className={sep} />
                        <button className={item} onClick={onRefresh}>
                            <RefreshCw className="w-3.5 h-3.5" /> {t('fileBrowser.refresh')}
                        </button>
                    </>
                )}
            </div>
        </>,
        document.body
    );
}
