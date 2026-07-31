import { cn } from '../../lib/utils';

/**
 * Shares the `flow` keyframe with FlowingBar and the terminal log caret so every loading
 * surface in the app moves on the same rhythm and the same accent colour.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <div className={cn('relative overflow-hidden rounded-md bg-foreground/[0.07]', className)} style={style} aria-hidden="true">
            <div className="absolute inset-y-0 w-1/3 animate-flow bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        </div>
    );
}

/** Placeholder rows matching the file list layout. */
export function FileListSkeleton({ rows = 9 }: { rows?: number }) {
    return (
        <div className="space-y-0.5 p-1" role="status" aria-busy="true">
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="flex h-8 items-center gap-2.5 rounded-lg px-2">
                    <Skeleton className="h-4 w-4 shrink-0 rounded" />
                    {/* Varying widths so it reads as a file list rather than a bar chart. */}
                    <Skeleton className="h-3" style={{ width: `${38 + ((index * 37) % 46)}%` }} />
                </div>
            ))}
        </div>
    );
}

/** Placeholder cards matching the system monitor layout. */
export function MonitorSkeleton() {
    return (
        <div className="space-y-2 p-2" role="status" aria-busy="true">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/55 bg-card/35 px-3 py-2.5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-12" />
            </div>
            {[0, 1, 2].map((card) => (
                <div key={card} className="space-y-2.5 rounded-xl border border-border/55 bg-card/35 p-3">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-10" />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" />
                    <div className="flex gap-2">
                        <Skeleton className="h-2 flex-1 rounded-full" />
                        <Skeleton className="h-2 flex-1 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}
