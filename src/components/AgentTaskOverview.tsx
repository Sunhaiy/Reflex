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
    soft: string;
    chipBg: string;
    chipText: string;
}> = {
    primary: {
        accent: 'hsl(var(--primary))',
        border: 'hsl(var(--primary) / 0.18)',
        soft: 'hsl(var(--primary) / 0.08)',
        chipBg: 'hsl(var(--primary) / 0.12)',
        chipText: 'hsl(var(--primary))',
    },
    muted: {
        accent: 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        soft: 'hsl(var(--background) / 0.82)',
        chipBg: 'hsl(var(--background) / 0.78)',
        chipText: 'hsl(var(--foreground) / 0.82)',
    },
    warning: {
        accent: 'rgb(245 158 11)',
        border: 'rgb(245 158 11 / 0.18)',
        soft: 'rgb(245 158 11 / 0.08)',
        chipBg: 'rgb(245 158 11 / 0.12)',
        chipText: 'rgb(251 191 36)',
    },
    danger: {
        accent: 'hsl(var(--destructive))',
        border: 'hsl(var(--destructive) / 0.18)',
        soft: 'hsl(var(--destructive) / 0.08)',
        chipBg: 'hsl(var(--destructive) / 0.12)',
        chipText: 'hsl(var(--destructive-foreground))',
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
    animated = false,
    className,
}: AgentTaskOverviewProps) {
    const palette = toneMap[tone];
    const safePercent = clampProgress(progressPercent);

    return (
        <section
            className={cn(
                'relative overflow-hidden rounded-[22px] border border-border bg-card text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.22)]',
                className,
            )}
        >
            <div className="relative p-5">
                <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3">
                    <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-background"
                    >
                        <Sparkles className="h-4.5 w-4.5" style={{ color: palette.accent }} />
                    </div>

                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span
                                className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium"
                                style={{ color: palette.chipText }}
                            >
                                {statusLabel}
                            </span>
                            {routeLabel && (
                                <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                                    {routeLabel}
                                </span>
                            )}
                            {repairLabel && (
                                <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                                    {repairLabel}
                                </span>
                            )}
                        </div>
                    </div>

                    {onToggleCollapsed && (
                        <button
                            type="button"
                            onClick={onToggleCollapsed}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            title={collapsed ? expandTitle : collapseTitle}
                        >
                            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        </button>
                    )}

                    <div className="col-start-2 min-w-0">
                        <h3 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.04em] text-foreground">
                            {headline}
                        </h3>

                        {description && (
                            <p className="mt-2 max-w-[56ch] text-sm leading-6 text-muted-foreground">
                                {description}
                            </p>
                        )}
                    </div>
                </div>

                {!collapsed && (
                    <div className="mt-6 grid gap-4">
                        {blockingReason && (
                            <div
                                className="flex items-start gap-3 rounded-2xl border px-4 py-3"
                                style={{
                                    borderColor: toneMap.warning.border,
                                    background: 'hsl(var(--background) / 0.72)',
                                }}
                            >
                                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                <div className="min-w-0">
                                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-300/90">
                                        {blockingReasonLabel}
                                    </div>
                                    <div className="mt-1 text-sm leading-6 text-foreground/88">
                                        {blockingReason}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-4">
                            <div className="min-w-[260px] flex-1 basis-[280px] rounded-2xl border border-border bg-background/70 px-4 py-4">
                                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    <Target className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                                    {nextActionLabel}
                                </div>
                                <div className="mt-3 text-[18px] font-medium leading-8 tracking-[-0.02em] text-foreground/94 break-words">
                                    {nextAction || '-'}
                                </div>
                            </div>

                            <div className="min-w-[260px] flex-1 basis-[280px] rounded-2xl border border-border bg-background/70 px-4 py-4">
                                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {lastProgressLabel}
                                </div>
                                <div className="mt-3 text-sm leading-6 text-foreground/86 break-words">
                                    {lastProgress || '-'}
                                </div>
                            </div>

                            <div
                                className="min-w-[320px] flex-[1.15] basis-[360px] rounded-2xl border px-4 py-4"
                                style={{
                                    borderColor: palette.border,
                                    background: `linear-gradient(180deg, hsl(var(--background) / 0.76), ${palette.soft})`,
                                }}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                            {progressLabel}
                                        </div>
                                        <div className="mt-3 text-[36px] font-semibold leading-none tracking-[-0.06em]" style={{ color: 'hsl(var(--primary))' }}>
                                            {safePercent}%
                                        </div>
                                    </div>
                                    <span
                                        className="inline-flex rounded-full border px-3 py-1 text-[11px] font-medium"
                                        style={{
                                            borderColor: palette.border,
                                            backgroundColor: palette.chipBg,
                                            color: 'hsl(var(--primary))',
                                        }}
                                    >
                                        {progressValue}
                                    </span>
                                </div>

                                <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-background/90">
                                    <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                            width: `${safePercent}%`,
                                            background: 'hsl(var(--primary))',
                                            boxShadow: `0 0 0 1px ${palette.border} inset${animated ? `, 0 0 18px ${palette.soft}` : ''}`,
                                        }}
                                    />
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                                    <span className="text-muted-foreground">0%</span>
                                    <span style={{ color: 'hsl(var(--primary))' }} className="font-medium">
                                        {progressValue}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background/56 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {progressLabel}
                                </div>
                                {todos.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                        {todos.length}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 space-y-3">
                                {todos.length > 0 ? (
                                    todos.map((todo, index) => {
                                        const isCompleted = todo.status === 'completed';
                                        const isActive = todo.status === 'in_progress';
                                        const label = isCompleted
                                            ? completedLabel
                                            : isActive
                                                ? inProgressLabel
                                                : pendingLabel;

                                        return (
                                            <div
                                                key={todo.id}
                                                className={cn(
                                                    'flex items-start gap-3 border-b border-border/70 pb-3',
                                                    index === todos.length - 1 && 'border-b-0 pb-0',
                                                )}
                                            >
                                                <div
                                                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background"
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

                                                <div className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">
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
                                    <div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-5 text-sm leading-6 text-muted-foreground">
                                        {emptyTodosLabel || 'No tasks yet.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
