import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, CancelCircleIcon, CheckmarkCircle02Icon, Delete02Icon, Download01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { useState } from 'react';
import { TransferItem } from './hooks/useTransferQueue';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';

interface Props {
    transfers: TransferItem[];
    onClearHistory: () => void;
}

export function TransferPanel({ transfers, onClearHistory }: Props) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(true);

    if (transfers.length === 0) return null;

    const active = transfers.filter(t => t.status === 'active');
    const history = transfers.filter(t => t.status !== 'active');

    return (
        <div className="mx-1.5 mb-1.5 shrink-0 overflow-hidden rounded-xl bg-foreground/[0.035]">
            {/* Header */}
            <div
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors select-none"
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
                <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-1">
                    {transfers.map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-xs px-1">
                            {/* Direction icon */}
                            {t.direction === 'download'
                                ? <HugeiconsIcon icon={Download01Icon} className="w-3 h-3 shrink-0 text-muted-foreground" />
                                : <HugeiconsIcon icon={Upload01Icon} className="w-3 h-3 shrink-0 text-muted-foreground" />
                            }
                            {/* Name */}
                            <span className="flex-1 truncate text-muted-foreground" title={t.name}>{t.name}</span>
                            {/* Status */}
                            {t.status === 'active' ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                        <div className="h-full w-1/2 animate-pulse rounded-full bg-foreground/75" />
                                    </div>
                                    <span className="w-8 text-right text-[10px] text-muted-foreground/60">···</span>
                                </div>
                            ) : t.status === 'done' ? (
                                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                                <div className="flex items-center gap-1 shrink-0" title={t.error}>
                                    <HugeiconsIcon icon={CancelCircleIcon} className="w-3.5 h-3.5 text-destructive" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
