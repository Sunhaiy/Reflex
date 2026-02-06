import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';

interface AIPopoverProps {
    x: number;
    y: number;
    text: string;
    type: 'explain' | 'fix';
    onClose: () => void;
    onApplyFix?: (command: string) => void;
}

export function AIPopover({ x, y, text, type, onClose, onApplyFix }: AIPopoverProps) {
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Position the popover
    const popoverWidth = 350;
    const popoverHeight = 300; // Estimated
    const padding = 20;

    const adjustedX = Math.min(x, window.innerWidth - popoverWidth - padding);
    const adjustedY = Math.min(y, window.innerHeight - popoverHeight - padding);

    useEffect(() => {
        const fetchAI = async () => {
            setIsLoading(true);
            setResponse('');
            setError(null);

            try {
                const promptType = type === 'explain' ? 'explainCommand' : 'errorAnalysis';
                const messages = [
                    { role: 'system' as const, content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS[promptType] },
                    { role: 'user' as const, content: text }
                ];

                for await (const chunk of aiService.streamComplete({ messages, temperature: 0.3 })) {
                    setResponse(prev => prev + chunk);
                    setIsLoading(false);
                }
            } catch (err: any) {
                setError(err.message || 'AI 请求失败');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAI();
    }, [text, type]);

    // Extract bash commands for Fix type
    const extractCommand = (text: string) => {
        const match = text.match(/```bash\n([\s\S]*?)```/) || text.match(/```\n([\s\S]*?)```/);
        return match ? match[1].trim() : null;
    };

    const fixCommand = type === 'fix' ? extractCommand(response) : null;

    return createPortal(
        <>
            <div className="fixed inset-0 z-[10000]" onClick={onClose} />
            <div
                className={cn(
                    "fixed z-[10001] w-[350px] max-h-[400px] flex flex-col bg-card border border-border rounded-xl shadow-2xl p-0 overflow-hidden shrink-0",
                    "animate-in slide-in-from-top-2 fade-in duration-200"
                )}
                style={{ left: adjustedX, top: adjustedY }}
            >
                {/* Header */}
                <div className={cn(
                    "px-4 py-3 flex items-center justify-between border-b border-border",
                    type === 'fix' ? "bg-orange-500/10" : "bg-primary/10"
                )}>
                    <div className="flex items-center gap-2">
                        {type === 'fix' ? (
                            <AlertTriangle className="w-4 h-4 text-orange-500" />
                        ) : (
                            <Sparkles className="w-4 h-4 text-primary" />
                        )}
                        <span className="text-sm font-semibold">
                            {type === 'fix' ? 'AI 报错分析' : 'AI 解释'}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-muted rounded-full transition-colors"
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-card/50">
                    {isLoading && !response && (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-3">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            <span className="text-xs">AI 正在思考...</span>
                        </div>
                    )}

                    {error && (
                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {response}
                        {isLoading && response && (
                            <span className="inline-block w-1 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                        )}
                    </div>
                </div>

                {/* Footer (only for Fix with code) */}
                {type === 'fix' && fixCommand && !isLoading && (
                    <div className="p-3 bg-muted/30 border-t border-border flex justify-end">
                        <button
                            onClick={() => {
                                onApplyFix?.(fixCommand);
                                onClose();
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all shadow-sm"
                        >
                            <Check className="w-3.5 h-3.5" />
                            应用修复
                        </button>
                    </div>
                )}
            </div>
        </>,
        document.body
    );
}
