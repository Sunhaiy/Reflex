import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
        focusable()[0]?.focus();
        const handleKey = (e: KeyboardEvent) => {
            const dialogs = document.querySelectorAll('[role="dialog"]');
            if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
            if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
            if (e.key === 'Tab') {
                const fields = focusable();
                const first = fields[0], last = fields[fields.length - 1];
                if (!first) { e.preventDefault(); return; }
                if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', handleKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-in fade-in duration-200">
            <div
                className={cn(
                    'glass-panel flex max-h-[94vh] w-full flex-col rounded-[calc(28px*var(--radius-scale))] animate-in zoom-in-95 duration-200',
                    size === 'sm' && 'max-w-sm',
                    size === 'md' && 'max-w-lg',
                    size === 'lg' && 'max-w-2xl',
                )}
                role="dialog"
                ref={dialogRef}
                aria-labelledby={titleId}
                aria-modal="true"
            >
                <div className="flex items-center justify-between px-6 pb-1.5 pt-5">
                    <h2 id={titleId} className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
                    <Button aria-label={t('common.close')} variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-xl">
                        <HugeiconsIcon icon={Cancel01Icon} className="w-4 h-4" />
                    </Button>
                </div>
                <div className="overflow-y-auto px-6 pb-5 pt-2">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
