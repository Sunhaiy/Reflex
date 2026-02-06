// AI Debugger - Analyzes terminal errors and provides fix suggestions

import { useState, useEffect } from 'react';
import { Sparkles, Terminal, Copy, Check, Loader2, AlertCircle, Play } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';

interface AIDebuggerProps {
    connectionId: string;
}

export function AIDebugger({ connectionId }: AIDebuggerProps) {
    const [errorText, setErrorText] = useState('');
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const handleAnalyze = async () => {
        if (!errorText.trim()) return;

        if (!aiService.isConfigured()) {
            setError('请先在设置中配置 AI API Key');
            return;
        }

        setIsLoading(true);
        setError(null);
        setAnalysis(null);

        try {
            const result = await aiService.analyzeError(errorText);
            setAnalysis(result);
        } catch (err: any) {
            setError(err.message || '分析失败');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const handleRunCommand = (command: string) => {
        window.electron?.writeTerminal(connectionId, command + '\n');
    };

    // Helper to extract code blocks from markdown
    const renderAnalysis = (text: string) => {
        const parts = text.split(/```(?:bash|sh|shell)?([\s\S]*?)```/g);
        return parts.map((part, index) => {
            // Every odd index is a code block from the split
            if (index % 2 === 1) {
                const command = part.trim();
                return (
                    <div key={index} className="my-3 rounded-md overflow-hidden border border-border bg-muted/30">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                            <span>建议命令</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleCopy(command, index)}
                                    className="hover:text-foreground transition-colors"
                                    title="复制"
                                >
                                    {copiedIndex === index ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                </button>
                                <button
                                    onClick={() => handleRunCommand(command)}
                                    className="hover:text-primary transition-colors text-primary"
                                    title="在终端运行"
                                >
                                    <Play className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        <pre className="p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                            {command}
                        </pre>
                    </div>
                );
            }
            return <div key={index} className="whitespace-pre-wrap leading-relaxed">{part}</div>;
        });
    };

    return (
        <div className="flex flex-col h-full bg-background p-4 overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold tracking-tight">智能报错诊断</h2>
            </div>

            <div className="flex flex-col gap-4">
                {/* Input area */}
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-muted-foreground">粘贴错误信息或命令输出</label>
                    <textarea
                        value={errorText}
                        onChange={(e) => setErrorText(e.target.value)}
                        placeholder="例如: Permission denied, Command not found, Connection refused..."
                        className="w-full h-32 p-3 rounded-md border border-input bg-muted/20 focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono resize-none"
                    />
                    <button
                        onClick={handleAnalyze}
                        disabled={isLoading || !errorText.trim()}
                        className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                正在智能排查中...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                开始诊断
                            </>
                        )}
                    </button>
                </div>

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Result area */}
                {analysis && (
                    <div className="flex flex-col gap-4 border-t border-border pt-4">
                        <div className="text-xs text-foreground animate-in fade-in duration-500">
                            {renderAnalysis(analysis)}
                        </div>
                    </div>
                )}

                {!analysis && !isLoading && !error && (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-3">
                        <Terminal className="w-10 h-10 opacity-20" />
                        <p className="text-xs text-center px-4">
                            复制终端里的红色报错信息粘贴到上方，<br />
                            AI 将帮你分析原因并提供一键修复命令。
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
