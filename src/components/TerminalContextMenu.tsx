import React from 'react';
import { createPortal } from 'react-dom';
import { Copy, HelpCircle, AlertTriangle } from 'lucide-react';

interface TerminalContextMenuProps {
    x: number;
    y: number;
    hasSelection: boolean;
    onCopy: () => void;
    onExplain: () => void;
    onFix: () => void;
    onClose: () => void;
}

export function TerminalContextMenu({
    x,
    y,
    hasSelection,
    onCopy,
    onExplain,
    onFix,
    onClose
}: TerminalContextMenuProps) {
    // Ensure menu stays within viewport
    const menuWidth = 200;
    const menuHeight = 160;
    const padding = 10;

    const adjustedX = Math.min(x, window.innerWidth - menuWidth - padding);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - padding);

    return createPortal(
        <>
            {/* Backdrop to close menu on click outside */}
            <div
                className="fixed inset-0 z-[9998]"
                onClick={onClose}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onClose();
                }}
            />

            <div
                className="fixed z-[9999] w-[200px] bg-card border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
                style={{ left: adjustedX, top: adjustedY }}
            >
                <button
                    onClick={() => {
                        onCopy();
                        onClose();
                    }}
                    disabled={!hasSelection}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                    <span>复制 (Copy)</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</span>
                </button>

                <div className="h-px bg-border my-1" />

                <button
                    onClick={() => {
                        onExplain();
                        onClose();
                    }}
                    disabled={!hasSelection}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    <HelpCircle className="w-4 h-4 text-indigo-500" />
                    <span>AI 解释 (Explain)</span>
                </button>

                <button
                    onClick={() => {
                        onFix();
                        onClose();
                    }}
                    disabled={!hasSelection}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-orange-500/10 hover:text-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    <span>AI 修复 (Fix)</span>
                </button>
            </div>
        </>,
        document.body
    );
}
