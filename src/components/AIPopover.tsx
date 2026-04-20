import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

interface AIPopoverProps {
    x: number;
    y: number;
    text: string;
    type: 'explain' | 'fix';
    onClose: () => void;
    onApplyFix?: (command: string) => void;
}

const AIResponseContent = React.memo(({
    isLoading,
    error,
    response,
    type,
    fixCommand,
    onApplyFix,
    onClose,
    labels,
}: {
    isLoading: boolean;
    error: string | null;
    response: string;
    type: 'explain' | 'fix';
    fixCommand: string | null;
    onApplyFix?: (cmd: string) => void;
    onClose: () => void;
    labels: {
        thinking: string;
        applyFix: string;
    };
}) => (
    <>
        <div className="min-h-[150px] flex-1 overflow-y-auto bg-popover p-4 custom-scrollbar">
            {isLoading && !response && (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3 text-muted-foreground">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    </div>
                    <span className="text-xs">{labels.thinking}</span>
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
                    {error}
                </div>
            )}

            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-popover-foreground">
                {response}
                {isLoading && response && (
                    <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary align-middle" />
                )}
            </div>
        </div>

        {type === 'fix' && fixCommand && !isLoading && (
            <div className="flex justify-end border-t border-border bg-background/60 p-3">
                <button
                    onClick={() => {
                        onApplyFix?.(fixCommand);
                        onClose();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                    <Check className="h-3.5 w-3.5" />
                    {labels.applyFix}
                </button>
            </div>
        )}
    </>
));

AIResponseContent.displayName = 'AIResponseContent';

export function AIPopover({ x, y, text, type, onClose, onApplyFix }: AIPopoverProps) {
    const { t, language } = useTranslation();
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEntered, setHasEntered] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef<number>();

    useEffect(() => {
        const popoverWidth = 380;
        const padding = 20;
        const initialX = Math.min(x, window.innerWidth - popoverWidth - padding);
        const initialY = Math.min(y, window.innerHeight - 350 - padding);

        positionRef.current = { x: initialX, y: initialY };
        if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${initialX}px, ${initialY}px, 0)`;
        }
    }, [x, y]);

    useEffect(() => {
        const fetchAI = async () => {
            setIsLoading(true);
            setResponse('');
            setError(null);

            try {
                if (!aiService.isConfigured()) {
                    setError(t('aiCommandInput.configureApi'));
                    return;
                }
                const result = type === 'explain'
                    ? await aiService.explainCommand(text)
                    : await aiService.analyzeError(text);
                setResponse(result.trim());
            } catch (err: any) {
                setError(err?.message || t('aiPopover.requestFailed'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchAI();
        const timer = window.setTimeout(() => setHasEntered(true), 500);
        return () => window.clearTimeout(timer);
    }, [text, type, t]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;

        const target = e.currentTarget as HTMLDivElement;
        target.setPointerCapture(e.pointerId);
        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX - positionRef.current.x,
            y: e.clientY - positionRef.current.y,
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !containerRef.current) return;

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            if (!containerRef.current) return;
            const newX = e.clientX - dragStartRef.current.x;
            const newY = e.clientY - dragStartRef.current.y;
            positionRef.current = { x: newX, y: newY };
            containerRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const target = e.currentTarget as HTMLDivElement;
        target.releasePointerCapture(e.pointerId);
        setIsDragging(false);

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`;
        }
    };

    useEffect(() => {
        document.body.style.userSelect = isDragging ? 'none' : '';
        return () => {
            document.body.style.userSelect = '';
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [isDragging]);

    const extractCommand = (content: string) => {
        const fencedMatch = content.match(/```bash\n([\s\S]*?)```/) || content.match(/```\n([\s\S]*?)```/);
        if (fencedMatch) return fencedMatch[1].trim();

        const inlineMatch = content.match(/`([^`\n]+)`/);
        if (inlineMatch) return inlineMatch[1].trim();

        const plainText = content.trim();
        if (plainText && !plainText.includes('\n') && !plainText.startsWith('AI ')) {
            return plainText;
        }

        return null;
    };

    const fixCommand = type === 'fix' ? extractCommand(response) : null;
    const subtitle = type === 'fix'
        ? (language === 'zh' ? '分析选中文本，并给出安全修复命令' : 'Analyze and suggest a safe command')
        : (language === 'zh' ? '解释选中的终端内容' : 'Explain the selected terminal text');

    return createPortal(
        <>
            <div className="fixed inset-0 z-[10000]" onClick={onClose} />
            <div
                ref={containerRef}
                className={cn(
                    'fixed z-[10001] flex max-h-[460px] w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-popover p-0 text-popover-foreground shadow-none',
                    !hasEntered && 'animate-in slide-in-from-top-2 fade-in duration-300',
                    isDragging && 'ring-2 ring-primary/20',
                )}
                style={{
                    left: 0,
                    top: 0,
                    transform: `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`,
                    willChange: isDragging ? 'transform' : 'auto',
                    transition: isDragging ? 'none' : undefined,
                }}
            >
                <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className={cn(
                        'flex shrink-0 select-none items-center justify-between border-b border-border bg-background/70 px-4 py-3',
                        isDragging ? 'cursor-grabbing' : 'cursor-grab',
                    )}
                    style={{ touchAction: 'none' }}
                >
                    <div className="pointer-events-none flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card">
                        {type === 'fix' ? (
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                        ) : (
                            <Sparkles className="h-4 w-4 text-primary" />
                        )}
                        </div>
                        <div>
                            <div className="text-sm font-semibold">
                                {type === 'fix' ? t('aiPopover.titleFix') : t('aiPopover.titleExplain')}
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {subtitle}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                <AIResponseContent
                    isLoading={isLoading}
                    error={error}
                    response={response}
                    type={type}
                    fixCommand={fixCommand}
                    onApplyFix={onApplyFix}
                    onClose={onClose}
                    labels={{
                        thinking: t('aiPopover.thinking'),
                        applyFix: t('aiPopover.applyFix'),
                    }}
                />
            </div>
        </>,
        document.body,
    );
}
