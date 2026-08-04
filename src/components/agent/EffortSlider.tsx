import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../shared/agent';
import { EFFORT_NAME } from './modes';

const STOPS = REASONING_EFFORTS;
const COLUMNS = 36;
const ROWS = 3;
/** Fixed rather than flexed, so a cell is a square at any panel width. */
const CELL = 4;

/**
 * Effort as a slider, because the values are an ordered scale and a list hides that:
 * where the thumb sits says which way is cheaper without reading a word.
 *
 * The track is a matrix of small squares rather than a solid bar, and the filled part
 * brightens toward the thumb. Both are doing the same job — a solid bar reads as a
 * continuum, and there are six discrete settings — while the gradient gives the eye
 * somewhere to land.
 *
 * The leftmost stop keeps a neutral colour. It is not the lowest effort; it means send no
 * field at all, and every other position adds one a strict gateway may reject. That is a
 * different kind of choice and should not look like the bottom of the scale.
 */
export function EffortSlider({ value, onChange }: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const index = Math.max(0, STOPS.indexOf(value));
  const ratio = index / (STOPS.length - 1);
  const neutral = value === 'auto';

  const setFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const position = (clientX - bounds.left) / bounds.width;
    const stop = Math.round(position * (STOPS.length - 1));
    onChange(STOPS[Math.min(STOPS.length - 1, Math.max(0, stop))]);
  };

  const beginDrag = (event: React.MouseEvent) => {
    setFromPointer(event.clientX);
    setDragging(true);
    const move = (moveEvent: MouseEvent) => setFromPointer(moveEvent.clientX);
    const release = () => {
      setDragging(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', release);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', release);
  };

  return (
    <div className="w-[248px] px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11.5px] text-muted-foreground">{t('settings.agent.effort')}</span>
        <span className={cn('text-[11.5px] font-medium', neutral ? 'text-muted-foreground' : 'text-primary')}>
          {EFFORT_NAME[value]}
        </span>
      </div>

      <div className="mt-2.5 flex justify-between text-[10.5px] text-muted-foreground">
        <span>{t('agent.effortFaster')}</span>
        <span>{t('agent.effortSmarter')}</span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={STOPS.length - 1}
        aria-valuenow={index}
        aria-valuetext={EFFORT_NAME[value]}
        aria-label={t('settings.agent.effort')}
        onMouseDown={beginDrag}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            onChange(STOPS[Math.max(0, index - 1)]);
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            onChange(STOPS[Math.min(STOPS.length - 1, index + 1)]);
          }
        }}
        className="relative mt-1.5 h-[26px] cursor-pointer select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div className="absolute inset-0 flex items-center justify-between overflow-hidden rounded-md">
          {Array.from({ length: COLUMNS }, (_, column) => {
            const at = column / (COLUMNS - 1);
            const filled = at <= ratio;
            // Brightest where the thumb is, fading back towards the cheap end.
            const intensity = ratio > 0 ? 0.16 + 0.66 * (at / ratio) : 0;
            // Each column answers a beat after its neighbour, and the delay is measured
            // from the thumb — so the ripple runs outward from wherever it landed rather
            // than always sweeping left to right.
            const delay = Math.abs(at - ratio) * 300;

            return (
              <span key={column} className="flex flex-col" style={{ gap: CELL - 1 }}>
                {Array.from({ length: ROWS }, (_, row) => (
                  <span
                    key={row}
                    style={{
                      width: CELL,
                      height: CELL,
                      background: filled && !neutral
                        ? `hsl(var(--primary) / ${intensity.toFixed(3)})`
                        : undefined,
                      transitionDelay: dragging ? '0ms' : `${delay.toFixed(0)}ms`,
                    }}
                    className={cn(
                      'transition-colors duration-300 ease-out',
                      filled && neutral && 'bg-muted-foreground/30',
                      !filled && 'bg-foreground/[0.07]',
                    )}
                  />
                ))}
              </span>
            );
          })}
        </div>

        <span
          style={{ left: `calc(${ratio * 100}% )` }}
          className={cn(
            'pointer-events-none absolute top-1/2 h-[24px] w-[20px] -translate-x-1/2 -translate-y-1/2 rounded-[7px] shadow-md',
            // Overshoots very slightly and settles, which is what reads as weight. While
            // dragging it drops to a near-instant linear move so it tracks the cursor
            // instead of swimming after it.
            dragging
              ? 'transition-[left] duration-75 ease-linear'
              : 'transition-[left,background-color] duration-[320ms] [transition-timing-function:cubic-bezier(0.34,1.4,0.5,1)]',
            neutral ? 'bg-muted-foreground/70' : 'bg-primary-foreground',
          )}
        />
      </div>

      <p className="mt-2.5 text-[10px] leading-4 text-muted-foreground">
        {neutral ? t('agent.effortAutoHint') : t('agent.effortHintOther')}
      </p>
    </div>
  );
}
