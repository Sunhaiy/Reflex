import { useCallback, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface SliderProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    'aria-label'?: string;
    className?: string;
}

/**
 * Native range inputs render a platform thumb with a hard border that ignores the theme,
 * so the visuals are drawn with divs and the real input is kept on top, transparent, to
 * preserve keyboard and drag behaviour.
 *
 * The fill only animates when the value changes without dragging (click on the track,
 * arrow keys) — easing it during a drag would make the thumb lag behind the cursor.
 */
export function Slider({ value, min, max, step = 1, onChange, className, ...props }: SliderProps) {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
    const eased = dragging ? undefined : 'width 180ms cubic-bezier(0.4, 0, 0.2, 1)';

    const stopDragging = useCallback(() => setDragging(false), []);

    return (
        <div className={cn('group relative flex h-5 min-w-0 items-center', className)}>
            {/* Track */}
            <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-foreground/[0.13]">
                <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percent}%`, transition: eased }}
                />
            </div>

            {/* Thumb */}
            <div
                className={cn(
                    'pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full bg-primary',
                    'ring-2 ring-background transition-[transform,box-shadow] duration-150 ease-out',
                    'group-hover:scale-110 group-focus-within:shadow-[0_0_0_5px_hsl(var(--primary)/0.18)]',
                    dragging && 'scale-95 shadow-[0_0_0_7px_hsl(var(--primary)/0.22)]',
                )}
                style={{
                    left: `${percent}%`,
                    transition: dragging
                        ? 'transform 150ms ease-out, box-shadow 150ms ease-out'
                        : 'left 180ms cubic-bezier(0.4, 0, 0.2, 1), transform 150ms ease-out, box-shadow 150ms ease-out',
                }}
            />

            <input
                ref={inputRef}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                onPointerDown={() => setDragging(true)}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onBlur={stopDragging}
                className="relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent focus:outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent"
                {...props}
            />
        </div>
    );
}
