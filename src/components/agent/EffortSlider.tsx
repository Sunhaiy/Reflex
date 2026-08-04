import { useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../shared/agent';
import { EFFORT_NAME } from './modes';

const STOPS = REASONING_EFFORTS;
const TRACK_INSET = 6;

/**
 * Effort as a compact discrete slider. The thin rail shows direction while one dot per
 * supported value makes it clear that the provider accepts six exact settings rather
 * than an arbitrary point on a continuum.
 *
 * The leftmost stop stays neutral because it sends no effort field at all; every other
 * position adds a field that strict compatible gateways may reject.
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
  const thumbLeft = `calc(${TRACK_INSET}px + ${ratio * 100}% - ${ratio * TRACK_INSET * 2}px)`;

  const setFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const usableWidth = Math.max(1, bounds.width - TRACK_INSET * 2);
    const position = (clientX - bounds.left - TRACK_INSET) / usableWidth;
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
    <div className="w-[220px] px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11.5px] text-muted-foreground">{t('settings.agent.effort')}</span>
        <span
          key={value}
          className={cn(
            'text-[11.5px] font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
            neutral ? 'text-muted-foreground' : 'text-primary',
          )}
        >
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
        className="relative mt-1 h-5 cursor-pointer select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div className="absolute inset-x-[6px] top-1/2 h-px -translate-y-1/2 rounded-full bg-foreground/[0.1]">
          <span
            style={{ width: `${ratio * 100}%` }}
            className={cn(
              'absolute inset-y-0 left-0 rounded-full',
              neutral ? 'bg-muted-foreground/35' : 'bg-primary/75',
              dragging
                ? 'transition-[width] duration-75 ease-linear'
                : 'transition-[width,background-color] [transition-duration:280ms] ease-out',
            )}
          />

          {STOPS.map((stop, stopIndex) => (
            <span
              key={stop}
              style={{ left: `${(stopIndex / (STOPS.length - 1)) * 100}%` }}
              className={cn(
                'absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background',
                'transition-colors duration-200',
                stopIndex <= index
                  ? (neutral ? 'bg-muted-foreground/55' : 'bg-primary/80')
                  : 'bg-muted-foreground/35',
              )}
            />
          ))}
        </div>

        <span
          style={{ left: thumbLeft }}
          className={cn(
            'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full',
            'ring-[3px] ring-background shadow-[0_2px_8px_hsl(var(--foreground)/0.2)]',
            dragging
              ? 'scale-110 transition-[left,transform] duration-75 ease-linear'
              : 'transition-[left,transform,background-color,box-shadow] [transition-duration:300ms] [transition-timing-function:cubic-bezier(0.34,1.4,0.5,1)]',
            neutral ? 'bg-muted-foreground' : 'bg-primary',
          )}
        />
      </div>

      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        {neutral ? t('agent.effortAutoHint') : t('agent.effortHintOther')}
      </p>
    </div>
  );
}
