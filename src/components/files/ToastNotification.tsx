import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, CancelCircleIcon, CheckmarkCircle02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { Toast } from './hooks/useFileBrowser';
import { cn } from '../../lib/utils';

interface Props {
    toasts: Toast[];
    onDismiss: (id: string) => void;
}

const icons = {
    error: <HugeiconsIcon icon={CancelCircleIcon} className="w-4 h-4 text-destructive shrink-0" />,
    success: <HugeiconsIcon icon={CheckmarkCircle02Icon} className="w-4 h-4 text-primary shrink-0" />,
    info: <HugeiconsIcon icon={InformationCircleIcon} className="w-4 h-4 text-blue-400 shrink-0" />,
};

export function ToastNotification({ toasts, onDismiss }: Props) {
    if (toasts.length === 0) return null;
    return (
        <div className="absolute bottom-3 right-3 z-50 flex flex-col gap-2 max-w-[280px]">
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={cn(
                        'flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs',
                        'bg-card/95 backdrop-blur-sm animate-in slide-in-from-bottom-2 fade-in',
                        t.type === 'error' && 'border-destructive/30',
                        t.type === 'success' && 'border-primary/30',
                        t.type === 'info' && 'border-blue-500/30',
                    )}
                >
                    {icons[t.type]}
                    <span className="flex-1 leading-relaxed">{t.message}</span>
                    <button onClick={() => onDismiss(t.id)} className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0">
                        <HugeiconsIcon icon={Cancel01Icon} className="w-3 h-3" />
                    </button>
                </div>
            ))}
        </div>
    );
}
