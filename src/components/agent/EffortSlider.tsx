import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../shared/agent';
import { EFFORT_LABEL } from './modes';

const STOPS = REASONING_EFFORTS;
const COLUMNS = 34;
const ROWS = 3;

/**
 * Effort as a slider, because the values are an ordered scale and a list hides that:
 * where the thumb sits says which way is cheaper without reading a word.
 *
 * The track is a dot matrix rather than a solid bar, and the filled part brightens toward
 * the thumb. Both are doing the same job — a solid bar reads as a continuum, and there
 * are five discrete settings — while the gradient gives the eye somewhere to land.
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
          {t(EFFORT_LABEL[value])}
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
        aria-valuetext={t(EFFORT_LABEL[value])}
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
        <div className="absolute inset-0 flex items-center gap-[2px] overflow-hidden rounded-md">
          {Array.from({ length: COLUMNS }, (_, column) => {
            const at = column / (COLUMNS - 1);
            const filled = at <= ratio;
            // Brightest where the thumb is, fading back towards the cheap end.
            const intensity = ratio > 0 ? 0.18 + 0.62 * (at / ratio) : 0;
            // Each column answers a beat after the one before it, so moving the thumb
            // reads as the track catching up rather than everything snapping at once.
            const delay = Math.abs(at - ratio) * 260;

            return (
              <span key={column} className="flex flex-1 flex-col gap-[2px]">
                {Array.from({ length: ROWS }, (_, row) => (
                  <span
                    key={row}
                    style={{
                      background: filled && !neutral
                        ? `hsl(var(--primary) / ${intensity.toFixed(3)})`
                        : undefined,
                      transitionDelay: `${delay.toFixed(0)}ms`,
                    }}
                    className={cn(
                      'h-[5px] rounded-[1.5px] transition-colors duration-300',
                      filled && neutral && 'bg-muted-foreground/25',
                      !filled && 'bg-foreground/[0.06]',
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
            'pointer-events-none absolute top-1/2 h-[26px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-md',
            'transition-[left,background-color] duration-300 ease-out',
            dragging && 'duration-75',
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
