// AI Command Input - Natural Language to Shell Command Component

import { useState, useRef, KeyboardEvent } from 'react';
import { Sparkles, Send, Loader2, Terminal } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';

interface AICommandInputProps {
    onCommandGenerated: (command: string) => void;
    currentPath?: string;
    className?: string;
}

export function AICommandInput({ onCommandGenerated, currentPath, className }: AICommandInputProps) {
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedCommand, setGeneratedCommand] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleGenerate = async () => {
        if (!input.trim()) return;

        if (!aiService.isConfigured()) {
            setError('请先在设置中配置 AI API Key');
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedCommand(null);

        try {
            const command = await aiService.textToCommand(input, currentPath);
            setGeneratedCommand(command);
        } catch (err: any) {
            setError(err.message || '生成命令失败');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleGenerate();
        } else if (e.key === 'Escape') {
            setGeneratedCommand(null);
            setError(null);
        }
    };

    const handleAcceptCommand = () => {
        if (generatedCommand) {
            onCommandGenerated(generatedCommand);
            setInput('');
            setGeneratedCommand(null);
        }
    };

    const handleClear = () => {
        setInput('');
        setGeneratedCommand(null);
        setError(null);
        inputRef.current?.focus();
    };

    return (
        <div className={cn(
            "flex flex-col gap-2 p-3 rounded-lg",
            "bg-background/95 border border-primary/30 shadow-lg",
            "animate-in slide-in-from-bottom-2 duration-200",
            className
        )}>
            {/* Input Row */}
            <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="描述你想执行的操作，例如：查找大于100M的文件..."
                    className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
                    disabled={isLoading}
                />
                <button
                    onClick={handleGenerate}
                    disabled={isLoading || !input.trim()}
                    className={cn(
                        "p-1.5 rounded-md transition-colors",
                        isLoading
                            ? "text-muted-foreground"
                            : "text-primary hover:bg-primary/20"
                    )}
                    title="生成命令 (Ctrl+Enter)"
                >
                    {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Send className="w-4 h-4" />
                    )}
                </button>
            </div>

            {/* Generated Command or Error */}
            {generatedCommand && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border">
                    <Terminal className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <code className="flex-1 text-sm font-mono text-foreground overflow-x-auto">
                        {generatedCommand}
                    </code>
                    <button
                        onClick={handleAcceptCommand}
                        className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                        填入终端
                    </button>
                    <button
                        onClick={handleClear}
                        className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                        重新生成
                    </button>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                    <span>⚠️ {error}</span>
                </div>
            )}

            {/* Hint */}
            <div className="text-xs text-muted-foreground">
                按 <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">Ctrl+Enter</kbd> 生成命令，
                <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">Esc</kbd> 关闭
            </div>
        </div>
    );
}
