import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Download01Icon, FolderAddIcon, FolderOpenIcon, PencilIcon, Refresh01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { createPortal } from 'react-dom';
import { FileEntry } from '../../shared/types';
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

const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-foreground/[0.06]';
const danger = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-destructive transition-colors hover:bg-destructive/10';
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
                className="fixed z-50 w-48 rounded-xl border border-border/70 bg-popover p-1.5 shadow-2xl animate-in fade-in zoom-in-95"
                style={{ top, left }}
                onClick={onClose}
            >
                {/* Label */}
                <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border/50 mb-1 truncate mx-1">
                    {file ? file.name : t('fileBrowser.currentDir')}
                </div>

                {file ? (
                    <>
                        <button className={item} onClick={() => onOpen(file)}>
                            {file.type === 'd' ? <HugeiconsIcon icon={FolderOpenIcon} className="w-3.5 h-3.5" /> : <HugeiconsIcon icon={ViewIcon} className="w-3.5 h-3.5" />}
                            {t(file.type === 'd' ? 'fileBrowser.open' : 'fileBrowser.preview')}
                        </button>
                        {file.type !== 'd' && (
                            <button className={item} onClick={() => onDownload(file)}>
                                <HugeiconsIcon icon={Download01Icon} className="w-3.5 h-3.5" /> {t('fileBrowser.download')}
                            </button>
                        )}
                        <button className={item} onClick={() => onRename(file)}>
                            <HugeiconsIcon icon={PencilIcon} className="w-3.5 h-3.5" /> {t('fileBrowser.rename')}
                        </button>
                        <div className={sep} />
                        <button className={danger} onClick={() => onDelete(file)}>
                            <HugeiconsIcon icon={Delete02Icon} className="w-3.5 h-3.5" /> {t('fileBrowser.delete')}
                        </button>
                    </>
                ) : (
                    <>
                        <button className={item} onClick={onNewFolder}>
                            <HugeiconsIcon icon={FolderAddIcon} className="w-3.5 h-3.5" /> {t('fileBrowser.newFolder')}
                        </button>
                        <button className={item} onClick={onNewFile}>
                            <HugeiconsIcon icon={Add01Icon} className="w-3.5 h-3.5" /> {t('fileBrowser.newFile')}
                        </button>
                        <div className={sep} />
                        <button className={item} onClick={onRefresh}>
                            <HugeiconsIcon icon={Refresh01Icon} className="w-3.5 h-3.5" /> {t('fileBrowser.refresh')}
                        </button>
                    </>
                )}
            </div>
        </>,
        document.body
    );
}
