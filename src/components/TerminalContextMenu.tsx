import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Clipboard, Copy, HelpCircle } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';

interface TerminalContextMenuProps {
    x: number;
    y: number;
    hasSelection: boolean;
    aiEnabled: boolean;
    onCopy: () => void;
    onPaste: () => void;
    onExplain: () => void;
    onFix: () => void;
    onClose: () => void;
}

export function TerminalContextMenu({
    x,
    y,
    hasSelection,
    aiEnabled,
    onCopy,
    onPaste,
    onExplain,
    onFix,
    onClose,
}: TerminalContextMenuProps) {
    const { t } = useTranslation();
    const menuWidth = 200;
    const menuHeight = aiEnabled ? 160 : 60;
    const padding = 10;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - padding);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - padding);

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-[9998]"
                onClick={onClose}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onClose();
                }}
            />

            <div
                className="fixed z-[9999] w-[200px] rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-none animate-in fade-in zoom-in-95 duration-100"
                style={{ left: adjustedX, top: adjustedY }}
            >
                <button
                    onClick={() => {
                        onCopy();
                        onClose();
                    }}
                    disabled={!hasSelection}
                    className="group flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    <span>{t('terminalMenu.copy')}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</span>
                </button>

                <button
                    onClick={() => {
                        onPaste();
                        onClose();
                    }}
                    className="group flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                >
                    <Clipboard className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    <span>{t('terminalMenu.paste')}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+V</span>
                </button>

                {aiEnabled && (
                    <>
                        <div className="my-1 h-px bg-border" />

                        <button
                            onClick={() => {
                                onExplain();
                                onClose();
                            }}
                            disabled={!hasSelection}
                            className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <HelpCircle className="h-4 w-4 text-indigo-500" />
                            <span>{t('terminalMenu.explain')}</span>
                        </button>

                        <button
                            onClick={() => {
                                onFix();
                                onClose();
                            }}
                            disabled={!hasSelection}
                            className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-orange-500/10 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                            <span>{t('terminalMenu.fix')}</span>
                        </button>
                    </>
                )}
            </div>
        </>,
        document.body,
    );
}
