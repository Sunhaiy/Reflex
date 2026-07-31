import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';
import { cn } from '../../lib/utils';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-in fade-in duration-200">
            <div
                className={cn(
                    'glass-panel flex max-h-[92vh] w-full flex-col rounded-[calc(28px*var(--radius-scale))] animate-in zoom-in-95 duration-200',
                    size === 'sm' && 'max-w-sm',
                    size === 'md' && 'max-w-lg',
                    size === 'lg' && 'max-w-2xl',
                )}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between px-6 pb-2 pt-6">
                    <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-xl">
                        <HugeiconsIcon icon={Cancel01Icon} className="w-4 h-4" />
                    </Button>
                </div>
                <div className="overflow-y-auto px-6 pb-6 pt-2">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
