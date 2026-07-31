import { cn } from '../../lib/utils';

/**
 * Indeterminate accent-coloured bar for short operations where a full log would be
 * noise. It sits above the content instead of covering it, so the list stays readable.
 */
export function FlowingBar({ className }: { className?: string }) {
    return (
        <div
            className={cn('h-[2px] w-full overflow-hidden bg-primary/15', className)}
            role="progressbar"
            aria-busy="true"
        >
            <div className="h-full w-1/3 animate-flow rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
    );
}
