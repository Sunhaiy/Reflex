import {
    Check,
    ChevronDown,
    ChevronUp,
    Clock3,
    RefreshCw,
    ShieldAlert,
    Sparkles,
    Target,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskTodoItem } from '../shared/types';
import { cn } from '../lib/utils';

type OverviewTone = 'primary' | 'muted' | 'warning' | 'danger';

interface AgentTaskOverviewProps {
    statusLabel: string;
    tone?: OverviewTone;
    routeLabel?: string;
    repairLabel?: string;
    headline: string;
    description?: string;
    nextAction?: string;
    nextActionLabel?: string;
    lastProgress?: string;
    lastProgressLabel?: string;
    blockingReason?: string;
    blockingReasonLabel?: string;
    progressLabel: string;
    progressValue: string;
    progressPercent: number;
    todos: TaskTodoItem[];
    emptyTodosLabel?: string;
    completedLabel: string;
    inProgressLabel: string;
    pendingLabel: string;
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    expandTitle?: string;
    collapseTitle?: string;
    animated?: boolean;
    className?: string;
}

const toneMap: Record<OverviewTone, {
    accent: string;
    border: string;
    chipBg: string;
    chipText: string;
}> = {
    primary: {
        accent: 'hsl(var(--primary))',
        border: 'hsl(var(--primary) / 0.24)',
        chipBg: 'hsl(var(--primary) / 0.12)',
        chipText: 'hsl(var(--primary))',
    },
    muted: {
        accent: 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        chipBg: 'hsl(var(--background) / 0.78)',
        chipText: 'hsl(var(--foreground) / 0.82)',
    },
    warning: {
        accent: 'rgb(245 158 11)',
        border: 'rgb(245 158 11 / 0.26)',
        chipBg: 'rgb(245 158 11 / 0.12)',
        chipText: 'rgb(245 158 11)',
    },
    danger: {
        accent: 'hsl(var(--destructive))',
        border: 'hsl(var(--destructive) / 0.24)',
        chipBg: 'hsl(var(--destructive) / 0.12)',
        chipText: 'hsl(var(--destructive))',
    },
};

function clampProgress(progressPercent: number) {
    if (Number.isNaN(progressPercent)) return 0;
    return Math.max(0, Math.min(100, progressPercent));
}

export function AgentTaskOverview({
    statusLabel,
    tone = 'muted',
    routeLabel,
    repairLabel,
    headline,
    description,
    nextAction,
    nextActionLabel = 'Next',
    lastProgress,
    lastProgressLabel = 'Last progress',
    blockingReason,
    blockingReasonLabel = 'Blocked',
    progressLabel,
    progressValue,
    progressPercent,
    todos,
    emptyTodosLabel,
    completedLabel,
    inProgressLabel,
    pendingLabel,
    collapsed = false,
    onToggleCollapsed,
    expandTitle = 'Expand',
    collapseTitle = 'Collapse',
    className,
}: AgentTaskOverviewProps) {
    const palette = toneMap[tone];
    const safePercent = clampProgress(progressPercent);

    return (
        <section className={cn('overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-none', className)}>
            <div className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                    <Sparkles className="h-5 w-5" style={{ color: palette.accent }} />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium"
                            style={{
                                borderColor: palette.border,
                                backgroundColor: palette.chipBg,
                                color: palette.chipText,
                            }}
                        >
                            {statusLabel}
                        </span>
                        {routeLabel && (
                            <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                                {routeLabel}
                            </span>
                        )}
                        {repairLabel && (
                            <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                                {repairLabel}
                            </span>
                        )}
                    </div>

                    <h3 className="mt-3 break-words text-xl font-semibold leading-snug tracking-[-0.02em] text-foreground">
                        {headline}
                    </h3>

                    {description && (
                        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>

                {onToggleCollapsed && (
                    <button
                        type="button"
                        onClick={onToggleCollapsed}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title={collapsed ? expandTitle : collapseTitle}
                    >
                        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </button>
                )}
            </div>

            {!collapsed && (
                <div className="space-y-4 border-t border-border/70 px-5 pb-5 pt-4">
                    {blockingReason && (
                        <div
                            className="flex items-start gap-3 rounded-xl border bg-background/70 px-4 py-3"
                            style={{ borderColor: toneMap.warning.border }}
                        >
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                            <div className="min-w-0">
                                <div className="text-[11px] font-medium text-amber-500">
                                    {blockingReasonLabel}
                                </div>
                                <div className="mt-1 break-words text-sm leading-6 text-foreground/90">
                                    {blockingReason}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                        <InfoPanel icon={<Target className="h-3.5 w-3.5" style={{ color: palette.accent }} />} label={nextActionLabel}>
                            {nextAction || '-'}
                        </InfoPanel>
                        <InfoPanel icon={<Clock3 className="h-3.5 w-3.5" />} label={lastProgressLabel}>
                            {lastProgress || '-'}
                        </InfoPanel>
                    </div>

                    <div className="rounded-xl border bg-background/60 px-4 py-4" style={{ borderColor: palette.border }}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground">{progressLabel}</div>
                            <span
                                className="rounded-full border px-2.5 py-1 text-xs font-medium"
                                style={{
                                    borderColor: palette.border,
                                    backgroundColor: palette.chipBg,
                                    color: 'hsl(var(--primary))',
                                }}
                            >
                                {progressValue}
                            </span>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-4">
                            <div className="text-3xl font-semibold leading-none tracking-[-0.04em]" style={{ color: 'hsl(var(--primary))' }}>
                                {safePercent}%
                            </div>
                            <div className="text-xs text-muted-foreground">0% / {progressValue}</div>
                        </div>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                    width: `${safePercent}%`,
                                    backgroundColor: 'hsl(var(--primary))',
                                }}
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground">{progressLabel}</div>
                            {todos.length > 0 && <div className="text-xs text-muted-foreground">{todos.length}</div>}
                        </div>

                        <div className="mt-3 space-y-1">
                            {todos.length > 0 ? (
                                todos.map((todo, index) => {
                                    const isCompleted = todo.status === 'completed';
                                    const isActive = todo.status === 'in_progress';
                                    const label = isCompleted ? completedLabel : isActive ? inProgressLabel : pendingLabel;

                                    return (
                                        <div
                                            key={todo.id}
                                            className={cn(
                                                'flex items-start gap-3 border-b border-border/70 py-3',
                                                index === 0 && 'pt-1',
                                                index === todos.length - 1 && 'border-b-0 pb-0',
                                            )}
                                        >
                                            <div
                                                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-card"
                                                style={{ borderColor: isActive || isCompleted ? palette.border : 'hsl(var(--border))' }}
                                            >
                                                {isCompleted ? (
                                                    <Check className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                                                ) : isActive ? (
                                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: palette.accent }} />
                                                ) : (
                                                    <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1 break-words text-sm leading-6 text-foreground/90">
                                                {todo.content}
                                            </div>

                                            <span
                                                className="inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                                                style={{
                                                    borderColor: isActive || isCompleted ? palette.border : 'hsl(var(--border))',
                                                    backgroundColor: isActive || isCompleted ? palette.chipBg : 'hsl(var(--background) / 0.68)',
                                                    color: isActive || isCompleted ? palette.chipText : 'hsl(var(--muted-foreground))',
                                                }}
                                            >
                                                {label}
                                            </span>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-5 text-sm leading-6 text-muted-foreground">
                                    {emptyTodosLabel || 'No tasks yet.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function InfoPanel({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {icon}
                {label}
            </div>
            <div className="mt-2 break-words text-sm font-medium leading-6 text-foreground/90">
                {children}
            </div>
        </div>
    );
}
