import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../shared/agent';
import { EffortFireField } from './EffortFireField';
import { EFFORT_NAME } from './modes';

const STOPS = REASONING_EFFORTS;
const TRACK_INSET = 8;

/**
 * Effort as a compact discrete slider. Dragging stays continuous, then snaps to the
 * values available for the current endpoint; the top tier swaps the regular fill for a
 * theme-aware fire field.
 *
 * The leftmost stop stays neutral because it sends no effort field at all; every other
 * position adds a field that strict compatible gateways may reject.
 */
export function EffortSlider({ value, availableValues = STOPS, onChange }: {
  value: ReasoningEffort;
  availableValues?: readonly ReasoningEffort[];
  onChange: (value: ReasoningEffort) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);

  const availableIndexes = STOPS
    .map((stop, stopIndex) => availableValues.includes(stop) ? stopIndex : -1)
    .filter((stopIndex) => stopIndex >= 0);
  const availableSet = new Set(availableValues);
  const requestedIndex = STOPS.indexOf(value);
  const index = availableSet.has(value)
    ? Math.max(0, requestedIndex)
    : (availableIndexes[0] ?? 0);
  const activeValue = STOPS[index];
  const ratio = index / (STOPS.length - 1);
  const visualRatio = dragging && dragPosition !== null ? dragPosition : ratio;
  const neutral = activeValue === 'auto';
  const ultraActive = availableSet.has('max')
    && index === STOPS.length - 1
    && (!dragging || visualRatio > 0.985);
  const thumbLeft = `calc(${TRACK_INSET}px + ${visualRatio * 100}% - ${visualRatio * TRACK_INSET * 2}px)`;
  const hint = neutral ? t('agent.effortAutoHint') : t('agent.effortHintOther');

  const setFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const usableWidth = Math.max(1, bounds.width - TRACK_INSET * 2);
    const position = Math.min(1, Math.max(0, (clientX - bounds.left - TRACK_INSET) / usableWidth));
    const closestIndex = availableIndexes.reduce((closest, candidate) => (
      Math.abs(candidate / (STOPS.length - 1) - position)
        < Math.abs(closest / (STOPS.length - 1) - position)
        ? candidate
        : closest
    ), availableIndexes[0] ?? 0);
    setDragPosition(closestIndex / (STOPS.length - 1));
    onChange(STOPS[closestIndex]);
  };

  const beginDrag = (event: React.MouseEvent) => {
    event.preventDefault();
    setFromPointer(event.clientX);
    setDragging(true);
    const move = (moveEvent: MouseEvent) => setFromPointer(moveEvent.clientX);
    const release = () => {
      setDragging(false);
      setDragPosition(null);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', release);
      window.removeEventListener('blur', release);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', release);
    window.addEventListener('blur', release);
  };

  return (
    <div className="w-[300px] max-w-[calc(100vw-28px)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">
            {t('settings.agent.effort')}
          </span>
          <span
            key={activeValue}
            className={cn(
              'truncate text-[12px] font-semibold animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
              neutral
                ? 'text-muted-foreground'
                : 'text-primary',
            )}
          >
            {EFFORT_NAME[activeValue]}
          </span>
        </div>

        <span
          tabIndex={0}
          title={hint}
          aria-label={hint}
          className={cn(
            'flex h-[17px] w-[17px] shrink-0 cursor-help select-none items-center justify-center rounded-full',
            'border border-muted-foreground/40 text-[10px] font-semibold leading-none text-muted-foreground',
            'transition-colors duration-150 hover:border-foreground/45 hover:text-foreground',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          )}
        >
          ?
        </span>
      </div>

      <div className="mt-5 flex justify-between text-[11px] font-medium text-muted-foreground">
        <span>{t('agent.effortFaster')}</span>
        <span>{t('agent.effortSmarter')}</span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, availableIndexes.length - 1)}
        aria-valuenow={Math.max(0, availableIndexes.indexOf(index))}
        aria-valuetext={EFFORT_NAME[activeValue]}
        aria-label={t('settings.agent.effort')}
        onMouseDown={beginDrag}
        onKeyDown={(event) => {
          const availableIndex = Math.max(0, availableIndexes.indexOf(index));
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            onChange(STOPS[availableIndexes[Math.max(0, availableIndex - 1)] ?? index]);
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            onChange(STOPS[
              availableIndexes[Math.min(availableIndexes.length - 1, availableIndex + 1)] ?? index
            ]);
          }
        }}
        className={cn(
          'relative mt-2.5 h-[30px] cursor-grab select-none overflow-hidden rounded-[9px] active:cursor-grabbing',
          'bg-foreground/[0.07] shadow-[inset_0_1px_0_hsl(var(--foreground)/0.045),inset_0_0_0_1px_hsl(var(--foreground)/0.04)]',
          'outline-none transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-ring/45',
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[9px]"
        >
          <span
            style={{ width: thumbLeft }}
            className={cn(
              'absolute inset-y-px left-px rounded-l-[8px] bg-foreground/[0.1]',
              dragging
                ? 'transition-[width,opacity] duration-75 ease-linear'
                : 'transition-[width,opacity] duration-200 ease-out',
              ultraActive && 'opacity-0',
            )}
          />
          <span
            className={cn(
              'absolute inset-0 bg-[linear-gradient(135deg,hsl(var(--background)/0.94),hsl(var(--foreground)/0.08))]',
              'transition-opacity duration-300 ease-in',
              ultraActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <EffortFireField active={ultraActive} />
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 top-1/2 z-[2] h-1 -translate-y-1/2"
        >
          {STOPS.map((stop, stopIndex) => (
            <span
              key={stop}
              style={{ left: `${(stopIndex / (STOPS.length - 1)) * 100}%` }}
              className={cn(
                'absolute top-0 h-1 w-1 -translate-x-1/2 rounded-full transition-[opacity,background-color] duration-200',
                availableSet.has(stop)
                  ? stopIndex === STOPS.length - 1
                    ? 'bg-primary/85'
                    : stopIndex <= index && !neutral
                      ? 'bg-foreground/55'
                      : 'bg-foreground/28'
                  : 'bg-foreground/20 opacity-20',
                ultraActive && availableSet.has(stop) && 'opacity-0',
              )}
            />
          ))}
        </div>

        <span
          style={{ left: thumbLeft }}
          className={cn(
            'pointer-events-none absolute top-1/2 z-[4] flex h-6 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px]',
            'ring-1 ring-background/55 shadow-[0_2px_8px_hsl(var(--background)/0.5),0_0_10px_hsl(var(--primary)/0.12)]',
            dragging
              ? 'scale-[1.06] shadow-[0_3px_10px_hsl(var(--background)/0.55),0_0_14px_hsl(var(--primary)/0.22)] transition-[left,transform,box-shadow] duration-75 ease-linear'
              : 'transition-[left,transform,background-color,box-shadow] [transition-duration:260ms] [transition-timing-function:cubic-bezier(0.34,1.4,0.5,1)]',
            ultraActive
              ? 'bg-white ring-white/20 shadow-[0_2px_8px_rgba(0,0,0,0.45),0_0_28px_hsl(var(--primary)/0.5),0_0_50px_hsl(var(--primary)/0.25)]'
              : neutral
                ? 'bg-muted-foreground'
                : 'bg-primary',
          )}
        >
          <span
            className={cn(
              'h-2 w-px rounded-full',
              ultraActive
                ? 'bg-black/20 shadow-[1.5px_0_0_rgba(0,0,0,0.08)]'
                : neutral
                ? 'bg-background/35 shadow-[1.5px_0_0_hsl(var(--background)/0.18)]'
                : 'bg-primary-foreground/45 shadow-[1.5px_0_0_hsl(var(--primary-foreground)/0.2)]',
            )}
          />
        </span>
      </div>
    </div>
  );
}
