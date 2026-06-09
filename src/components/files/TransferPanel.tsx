import { useState } from 'react';
import { TransferItem } from './hooks/useTransferQueue';
import { Download, Upload, CheckCircle2, XCircle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
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
        <div className="border-t border-border shrink-0 bg-card/50">
            {/* Header */}
            <div
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                onClick={() => setExpanded(v => !v)}
            >
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                    {t('fileBrowser.transfers')}
                    {active.length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 bg-primary/20 text-primary rounded-full">{active.length}</span>
                    )}
                </span>
                {history.length > 0 && (
                    <button
                        onClick={e => { e.stopPropagation(); onClearHistory(); }}
                        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title={t('fileBrowser.clearHistory')}
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                )}
                {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
            </div>

            {expanded && (
                <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-1">
                    {transfers.map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-xs px-1">
                            {/* Direction icon */}
                            {t.direction === 'download'
                                ? <Download className="w-3 h-3 shrink-0 text-blue-400" />
                                : <Upload className="w-3 h-3 shrink-0 text-emerald-400" />
                            }
                            {/* Name */}
                            <span className="flex-1 truncate text-muted-foreground" title={t.name}>{t.name}</span>
                            {/* Status */}
                            {t.status === 'active' ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary rounded-full transition-all duration-300"
                                            style={{ width: `${t.progress}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground/60 w-8 text-right tabular-nums">{t.progress}%</span>
                                </div>
                            ) : t.status === 'done' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                                <div className="flex items-center gap-1 shrink-0" title={t.error}>
                                    <XCircle className="w-3.5 h-3.5 text-destructive" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
