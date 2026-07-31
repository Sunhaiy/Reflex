import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Download01Icon, FileCodeIcon, Image01Icon, PencilIcon, RotateRight01Icon, ZoomInAreaIcon, ZoomOutAreaIcon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileOpenResult } from './hooks/useFileBrowser';
import { formatSize } from './utils/fileUtils';
import { TEXT_ENCODING_OPTIONS } from './utils/fileUtils';
import { useTranslation } from '../../hooks/useTranslation';
import type { TextFileEncoding } from '../../shared/types';

interface Props {
    file: FileOpenResult;
    onClose: () => void;
    onEdit: () => void;
    onDownload: () => void;
    onEncodingChange: (encoding: TextFileEncoding) => void;
}

const actionClass = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30';

export function FilePreview({ file, onClose, onEdit, onDownload, onEncodingChange }: Props) {
    const { t } = useTranslation();
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        setScale(1);
        setRotation(0);
        setImageError(false);
    }, [file.kind, file.path]);

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-in fade-in duration-200" onMouseDown={onClose}>
            <section
                className="flex h-[min(760px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background animate-in fade-in zoom-in-95 duration-200 ease-out"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`${t('fileBrowser.preview')} ${file.name}`}
            >
                <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground">
                            {file.kind === 'image' ? <HugeiconsIcon icon={Image01Icon} className="h-4 w-4" /> : <HugeiconsIcon icon={FileCodeIcon} className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold">{file.name}</h2>
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                {formatSize(file.entry.size)} · {file.path}
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 rounded-xl bg-foreground/[0.035] p-1">
                        {file.kind === 'image' && (
                            <>
                                <button type="button" className={actionClass} onClick={() => setScale((value) => Math.max(0.2, value - 0.2))} title={t('fileBrowser.zoomOut')}>
                                    <HugeiconsIcon icon={ZoomOutAreaIcon} className="h-3.5 w-3.5" />
                                </button>
                                <span className="w-10 text-center text-[10px] tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
                                <button type="button" className={actionClass} onClick={() => setScale((value) => Math.min(4, value + 0.2))} title={t('fileBrowser.zoomIn')}>
                                    <HugeiconsIcon icon={ZoomInAreaIcon} className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" className={actionClass} onClick={() => setRotation((value) => (value + 90) % 360)} title={t('fileBrowser.rotate')}>
                                    <HugeiconsIcon icon={RotateRight01Icon} className="h-3.5 w-3.5" />
                                </button>
                            </>
                        )}
                        {file.kind === 'text' && (
                            <select
                                value={file.encoding ?? 'utf-8'}
                                onChange={(event) => onEncodingChange(event.target.value as TextFileEncoding)}
                                className="h-8 rounded-lg border-0 bg-transparent px-2 text-[11px] text-muted-foreground outline-none hover:bg-foreground/[0.07] hover:text-foreground"
                                aria-label={t('fileBrowser.encoding')}
                                title={t('fileBrowser.encoding')}
                            >
                                {TEXT_ENCODING_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        )}
                        <button type="button" className={actionClass} onClick={onDownload}>
                            <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{t('fileBrowser.download')}</span>
                        </button>
                        {file.kind === 'text' && (
                            <button type="button" className={actionClass} onClick={onEdit}>
                                <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{t('fileBrowser.edit')}</span>
                            </button>
                        )}
                        <button type="button" className={actionClass} onClick={onClose} title={t('fileBrowser.closePreview')}>
                            <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
                        </button>
                    </div>
                </header>

                <div className="min-h-0 flex-1 px-3 pb-3">
                    <div className="relative flex h-full min-h-0 overflow-auto rounded-xl border border-border/60 bg-foreground/[0.025]">
                        {file.kind === 'image' ? (
                            <div className="flex min-h-full min-w-full items-center justify-center p-6">
                                {imageError ? (
                                    <p className="text-sm text-muted-foreground">{t('fileBrowser.imageLoadFailed')}</p>
                                ) : (
                                    // The entrance sits on the wrapper so it cannot clash with the
                                    // transform transition below, and it runs on mount rather than on
                                    // `load` — a data URL can finish decoding before React attaches the
                                    // handler, which used to leave the image stuck invisible.
                                    <div
                                        key={file.path}
                                        className="animate-in fade-in zoom-in-95 duration-300 ease-out"
                                    >
                                        <img
                                            src={file.content}
                                            alt={file.name}
                                            draggable={false}
                                            className="max-w-none rounded-lg object-contain transition-transform duration-200 ease-out"
                                            style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
                                            onError={() => setImageError(true)}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <pre className="min-h-full min-w-full select-text whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground/85">
                                {file.content}
                            </pre>
                        )}
                    </div>
                </div>
            </section>
        </div>,
        document.body,
    );
}
