import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, CancelCircleIcon, CheckmarkCircle02Icon, Delete02Icon, Download01Icon, FolderOpenIcon, Refresh01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { useState } from 'react';
import { TransferItem } from './hooks/useTransferQueue';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';

interface Props {
    transfers: TransferItem[];
    onClearHistory: () => void;
    onOpenLocation: (transfer: TransferItem) => void;
    onRetry: (transfer: TransferItem) => void;
}

export function TransferPanel({ transfers, onClearHistory, onOpenLocation, onRetry }: Props) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(true);

    if (transfers.length === 0) return null;

    const active = transfers.filter(t => t.status === 'active');
    const history = transfers.filter(t => t.status !== 'active');

    return (
        <div className="mx-1.5 mb-1.5 shrink-0 overflow-hidden rounded-xl border border-border/45 bg-foreground/[0.025]">
            {/* Header */}
            <div
                className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/30"
                onClick={() => setExpanded(v => !v)}
            >
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                    {t('fileBrowser.transfers')}
                    {active.length > 0 && (
                        <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-foreground">{active.length}</span>
                    )}
                </span>
                {history.length > 0 && (
                    <button
                        onClick={e => { e.stopPropagation(); onClearHistory(); }}
                        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title={t('fileBrowser.clearHistory')}
                    >
                        <HugeiconsIcon icon={Delete02Icon} className="w-3 h-3" />
                    </button>
                )}
                {expanded ? <HugeiconsIcon icon={ArrowDown01Icon} className="w-3 h-3 text-muted-foreground" /> : <HugeiconsIcon icon={ArrowUp01Icon} className="w-3 h-3 text-muted-foreground" />}
            </div>

            {expanded && (
                <div className="max-h-40 space-y-1 overflow-y-auto px-1.5 pb-1.5">
                    {transfers.map(transfer => {
                        const canOpen = transfer.direction === 'download' && transfer.status === 'done';
                        return (
                        <div
                            key={transfer.id}
                            role={canOpen ? 'button' : undefined}
                            tabIndex={canOpen ? 0 : undefined}
                            className={cn(
                                'flex min-h-8 items-center gap-2 rounded-lg px-2 text-xs transition-colors',
                                canOpen && 'cursor-pointer hover:bg-foreground/[0.055]',
                            )}
                            onClick={() => { if (canOpen) onOpenLocation(transfer); }}
                            onKeyDown={(event) => {
                                if (canOpen && (event.key === 'Enter' || event.key === ' ')) onOpenLocation(transfer);
                            }}
                            title={canOpen ? t('fileBrowser.openInFolder') : transfer.error}
                        >
                            {/* Direction icon */}
                            {transfer.direction === 'download'
                                ? <HugeiconsIcon icon={Download01Icon} className="w-3 h-3 shrink-0 text-muted-foreground" />
                                : <HugeiconsIcon icon={Upload01Icon} className="w-3 h-3 shrink-0 text-muted-foreground" />
                            }
                            {/* Name */}
                            <span className="min-w-0 flex-1 truncate text-foreground/80" title={transfer.name}>{transfer.name}</span>
                            {/* Status */}
                            {transfer.status === 'active' ? (
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
                                        <div className="h-full rounded-full bg-foreground/75 transition-[width]" style={{ width: `${transfer.progress}%` }} />
                                    </div>
                                    <span className="w-7 text-right text-[9px] tabular-nums text-muted-foreground">{transfer.progress}%</span>
                                </div>
                            ) : transfer.status === 'done' ? (
                                <span className="flex shrink-0 items-center gap-1 text-primary">
                                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
                                    {canOpen && <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5 text-muted-foreground" />}
                                </span>
                            ) : (
                                <div className="flex shrink-0 items-center gap-1" title={transfer.error}>
                                    <HugeiconsIcon icon={CancelCircleIcon} className="h-3.5 w-3.5 text-destructive" />
                                    <button
                                        type="button"
                                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
                                        onClick={(event) => { event.stopPropagation(); onRetry(transfer); }}
                                        title={t('fileBrowser.resumeTransfer')}
                                    >
                                        <HugeiconsIcon icon={Refresh01Icon} className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    );})}
                </div>
            )}
        </div>
    );
}
