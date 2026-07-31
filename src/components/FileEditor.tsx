import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, FileScriptIcon, FloppyDiskIcon, Loading02Icon, Maximize02Icon, Minimize02Icon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from '../hooks/useTranslation';
import type { TextFileEncoding } from '../shared/types';

interface FileEditorProps {
    fileName: string;
    filePath: string;
    initialContent: string;
    encoding: TextFileEncoding;
    onSave: (content: string) => Promise<void>;
    onClose: () => void;
}

const EDITOR_WIDTH = 920;
const EDITOR_HEIGHT = 620;

export function FileEditor({ fileName, filePath, initialContent, encoding, onSave, onClose }: FileEditorProps) {
    const { t } = useTranslation();
    const [content, setContent] = useState(initialContent);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [saveError, setSaveError] = useState('');
    const { terminalFontFamily, fontSize } = useSettingsStore();

    const windowRef = useRef<HTMLDivElement>(null);
    const savedContentRef = useRef(initialContent);
    const isDragging = useRef(false);
    const dragStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
    const pos = useRef({ x: 0, y: 0 });

    // Center the floating editor after its responsive size has been resolved.
    useEffect(() => {
        const rect = windowRef.current?.getBoundingClientRect();
        const width = rect?.width ?? EDITOR_WIDTH;
        const height = rect?.height ?? EDITOR_HEIGHT;
        const x = Math.max(0, Math.round((window.innerWidth - width) / 2));
        const y = Math.max(0, Math.round((window.innerHeight - height) / 2));
        pos.current = { x, y };
        if (windowRef.current) {
            windowRef.current.style.transform = `translate(${x}px,${y}px)`;
        }
    }, []);

    const onMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (isMaximized) return;
        isDragging.current = true;
        dragStart.current = {
            mx: event.clientX,
            my: event.clientY,
            tx: pos.current.x,
            ty: pos.current.y,
        };
        event.preventDefault();
    }, [isMaximized]);

    useEffect(() => {
        const onMove = (event: MouseEvent) => {
            const editor = windowRef.current;
            if (!isDragging.current || !editor) return;

            const x = Math.max(
                0,
                Math.min(
                    window.innerWidth - editor.offsetWidth,
                    dragStart.current.tx + event.clientX - dragStart.current.mx,
                ),
            );
            const y = Math.max(
                0,
                Math.min(
                    window.innerHeight - 40,
                    dragStart.current.ty + event.clientY - dragStart.current.my,
                ),
            );
            pos.current = { x, y };
            editor.style.transform = `translate(${x}px,${y}px)`;
        };
        const onUp = () => { isDragging.current = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const handleEditorChange = (value: string) => {
        setContent(value);
        setIsDirty(value !== savedContentRef.current);
        setSaveError('');
    };

    const handleSave = useCallback(async () => {
        if (!isDirty || isSaving) return;
        setIsSaving(true);
        setSaveError('');
        try {
            await onSave(content);
            savedContentRef.current = content;
            setIsDirty(false);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSaving(false);
        }
    }, [content, isDirty, isSaving, onSave]);

    const requestClose = useCallback(() => {
        if (isDirty && !window.confirm(t('editor.confirmClose'))) return;
        onClose();
    }, [isDirty, onClose]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void handleSave();
            }
            if (event.key === 'Escape') requestClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, requestClose]);

    const windowStyle: React.CSSProperties = isMaximized
        ? { position: 'fixed', inset: 0, borderRadius: 0 }
        : {
            position: 'fixed',
            left: 0,
            top: 0,
            width: 'min(920px, calc(100vw - 32px))',
            height: 'min(620px, calc(100vh - 32px))',
            willChange: 'transform',
        };

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-[45] bg-black/25 backdrop-blur-[1px]"
                onClick={requestClose}
            />

            <div
                ref={windowRef}
                className="z-[70] flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-background"
                style={windowStyle}
                onClick={(event) => event.stopPropagation()}
            >
                <div
                    className="flex min-h-14 shrink-0 cursor-move select-none items-center justify-between bg-card px-4"
                    onMouseDown={onMouseDown}
                    onDoubleClick={() => setIsMaximized((value) => !value)}
                >
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06]">
                            <HugeiconsIcon icon={FileScriptIcon} className="h-4 w-4 text-foreground" />
                        </span>
                        <div className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 text-xs font-medium leading-tight">
                                {fileName}
                                {isDirty && (
                                    <span
                                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500"
                                        title={t('editor.unsaved')}
                                    />
                                )}
                            </span>
                            <span className="max-w-[500px] truncate text-[10px] leading-tight text-muted-foreground">
                                {filePath} · {encoding.toUpperCase()}
                            </span>
                        </div>
                    </div>
                    <div
                        className="ml-2 flex shrink-0 items-center gap-1"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSave()}
                            disabled={isSaving || !isDirty}
                            className="h-7 gap-1.5 px-2 text-xs"
                        >
                            {isSaving ? (
                                <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
                            ) : (
                                <HugeiconsIcon icon={FloppyDiskIcon} className="h-3 w-3" />
                            )}
                            {t('editor.save')}
                        </Button>
                        <button
                            onClick={() => setIsMaximized((value) => !value)}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            title={isMaximized ? t('editor.restore') : t('editor.maximize')}
                        >
                            {isMaximized ? (
                                <HugeiconsIcon icon={Minimize02Icon} className="h-3.5 w-3.5" />
                            ) : (
                                <HugeiconsIcon icon={Maximize02Icon} className="h-3.5 w-3.5" />
                            )}
                        </button>
                        <button
                            onClick={requestClose}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                            title={t('editor.close')}
                        >
                            <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {saveError && (
                    <div className="mx-3 mb-2 shrink-0 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {t('editor.saveFailed')}: {saveError}
                    </div>
                )}

                <textarea
                    value={content}
                    onChange={(event) => handleEditorChange(event.target.value)}
                    aria-label={t('editor.editAria', { name: fileName })}
                    spellCheck={false}
                    className="m-3 mt-0 min-h-0 flex-1 resize-none rounded-xl border border-border/60 bg-foreground/[0.025] p-4 text-foreground outline-none selection:bg-foreground/20 focus:border-foreground/20"
                    style={{
                        fontFamily: terminalFontFamily,
                        fontSize: Math.max(12, Math.min(fontSize, 18)),
                        lineHeight: 1.55,
                        tabSize: 4,
                    }}
                />
            </div>
        </>,
        document.body,
    );
}
