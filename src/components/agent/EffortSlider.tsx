import { useRef } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../shared/agent';
import { EFFORT_LABEL } from './modes';

const STOPS = REASONING_EFFORTS;

/**
 * Effort as a slider rather than a list, because the values are an ordered scale and a
 * list hides that. Where the thumb sits says which way is cheaper without reading a word.
 *
 * The leftmost stop is not the lowest effort — it is "send nothing", which is a different
 * kind of choice: every other position adds a field that a strict gateway may reject. It
 * gets its own colour so it is not mistaken for the bottom of the scale.
 */
export function EffortSlider({ value, onChange }: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const index = Math.max(0, STOPS.indexOf(value));

  const setFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const ratio = (clientX - bounds.left) / bounds.width;
    const stop = Math.round(ratio * (STOPS.length - 1));
    onChange(STOPS[Math.min(STOPS.length - 1, Math.max(0, stop))]);
  };

  return (
    <div className="w-[236px] px-2 py-1.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{t('settings.agent.effort')}</span>
        <span className={cn(
          'text-[11.5px] font-medium',
          value === 'auto' ? 'text-muted-foreground' : 'text-primary',
        )}>
          {t(EFFORT_LABEL[value])}
        </span>
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
        onMouseDown={(event) => {
          setFromPointer(event.clientX);
          const move = (moveEvent: MouseEvent) => setFromPointer(moveEvent.clientX);
          const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        }}
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
        className="relative h-6 cursor-pointer select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* The track is drawn as ticks so the stops are countable — a plain bar would
            suggest a continuum, and there are five discrete settings. */}
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 gap-[3px]">
          {Array.from({ length: 28 }, (_, tick) => {
            const filled = tick / 27 <= index / (STOPS.length - 1);
            return (
              <span
                key={tick}
                className={cn(
                  'h-3.5 flex-1 rounded-[2px] transition-colors',
                  filled
                    ? (value === 'auto' ? 'bg-muted-foreground/45' : 'bg-primary/60')
                    : 'bg-foreground/[0.07]',
                )}
              />
            );
          })}
        </div>

        <span
          style={{ left: `${(index / (STOPS.length - 1)) * 100}%` }}
          className={cn(
            'pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-colors',
            value === 'auto'
              ? 'border-border bg-card'
              : 'border-primary/60 bg-primary-foreground',
          )}
        />
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{t('agent.effortFaster')}</span>
        <span>{t('agent.effortSmarter')}</span>
      </div>

      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        {value === 'auto' ? t('agent.effortAutoHint') : t('agent.effortHintOther')}
      </p>
    </div>
  );
}
