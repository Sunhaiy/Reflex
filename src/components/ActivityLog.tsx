import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import type { ActivityLevel, ActivityLine } from '../shared/types';

// Everything follows the accent colour instead of green/red, so a failed step reads as
// information rather than an alarm. Errors stay distinguishable via the tinted background.
const levelClass: Record<ActivityLevel, string> = {
    cmd: 'text-foreground font-semibold',
    ok: 'text-primary',
    info: 'text-muted-foreground',
    dim: 'text-muted-foreground/45',
    error: 'rounded bg-primary/[0.09] px-1.5 text-primary',
};

interface ActivityLogProps {
    lines: ActivityLine[];
    /** Rendered above the lines before anything has arrived. */
    placeholder?: string;
    className?: string;
    size?: 'sm' | 'md';
}

/**
 * The single loading presentation used by the terminal, the right panel and the
 * file browser. Every line comes from a real event — nothing here is simulated.
 */
export function ActivityLog({ lines, placeholder, className, size = 'md' }: ActivityLogProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Scroll only this container — scrollIntoView would also scroll every ancestor,
        // which made the surrounding panel jump while lines streamed in.
        const container = containerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [lines.length]);

    return (
        <div
            ref={containerRef}
            className={cn(
                'h-full overflow-y-auto p-3 font-mono leading-[1.75]',
                size === 'sm' ? 'text-[10px]' : 'text-[11px]',
                className,
            )}
            role="status"
            aria-live="polite"
        >
            {lines.length === 0 && placeholder && (
                <div className="text-muted-foreground/45">{placeholder}</div>
            )}
            {lines.map((line) => (
                <div
                    key={line.id}
                    className={cn(
                        'w-fit max-w-full whitespace-pre-wrap break-all',
                        'animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out',
                        levelClass[line.level],
                    )}
                >
                    {line.text}
                </div>
            ))}
            <span className="mt-0.5 inline-block h-[13px] w-[6px] animate-caret-blink bg-primary/80 align-middle" />
        </div>
    );
}

let localLineId = 0;

/** Builds a line for progress produced inside the renderer (file browser, monitor). */
export function activityLine(text: string, level: ActivityLevel = 'info'): ActivityLine {
    return { id: --localLineId, text, level, at: Date.now() };
}
