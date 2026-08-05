import { HugeiconsIcon } from "@hugeicons/react";
import { FileAttachmentIcon, Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

export function LogViewer({ connectionId, containerId, containerName }: { connectionId: string; containerId: string; containerName: string }) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const text = await window.electron.dockerLogs(connectionId, containerId, 300);
            setLogs(text);
            window.setTimeout(() => logRef.current?.scrollTo(0, logRef.current!.scrollHeight), 50);
        } catch {
            setLogs(t('dockerManager.fetchLogsFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [containerId]);

    const lines = logs.split('\n');
    const filteredLines = searchTerm
        ? lines.filter((line) => line.toLowerCase().includes(searchTerm.toLowerCase()))
        : lines;

    const highlightSearch = (line: string) => {
        if (!searchTerm) return line;
        const idx = line.toLowerCase().indexOf(searchTerm.toLowerCase());
        if (idx === -1) return line;
        return (
            <>
                {line.slice(0, idx)}
                <span className="rounded bg-yellow-500/30 px-0.5 text-yellow-200">
                    {line.slice(idx, idx + searchTerm.length)}
                </span>
                {line.slice(idx + searchTerm.length)}
            </>
        );
    };

    return (
        <div className="border-t border-border bg-background/80">
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
                <HugeiconsIcon icon={FileAttachmentIcon} className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">{containerName} {t('dockerManager.logs')}</span>
                <div className="relative flex-1">
                    <HugeiconsIcon icon={Search01Icon} className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('common.search')}
                        className="w-full rounded border border-transparent bg-secondary/50 py-0.5 pl-6 pr-2 text-[10px] outline-none focus:border-primary/50"
                    />
                </div>
                <button onClick={fetchLogs} className="rounded p-1 hover:bg-secondary" title={t('dockerManager.refresh')}>
                    <HugeiconsIcon icon={Refresh01Icon} className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div ref={logRef} className="scrollbar-hide h-[200px] overflow-y-auto p-2 font-mono text-[10px] leading-[1.6] text-muted-foreground">
                {filteredLines.map((line, index) => (
                    <div key={index} className="whitespace-pre-wrap break-all px-1 hover:bg-muted/30">
                        {highlightSearch(line)}
                    </div>
                ))}
                {loading && (
                    <div className="py-4 text-center text-muted-foreground/50 animate-pulse">
                        {t('dockerManager.loading')}
                    </div>
                )}
            </div>
        </div>
    );
}
