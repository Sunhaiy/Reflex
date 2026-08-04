import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';

/** Past this the ring takes the theme colour: compaction is close, not hypothetical. */
const NEAR_FULL = 0.7;

const SIZE = 18;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TOOLTIP_MARGIN = 8;

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/**
 * How full the context is, as a ring.
 *
 * A number alone never said whether it was a lot; a ring does at a glance. It fills with
 * the count the endpoint reported for the last request, takes the theme colour as the
 * budget approaches, and falls back on its own once the history is compacted — so staying
 * inside the window is something you watch happen rather than infer from output going
 * missing.
 *
 * The detail sits behind a hover rather than on screen: what it costs is worth knowing
 * occasionally and not worth a permanent line in a toolbar this narrow.
 */
export function ContextRing({ used, budget, spent }: {
  used: number;
  budget: number;
  /** Every token this conversation has paid for, input and output together. */
  spent: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tooltipLeft, setTooltipLeft] = useState<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const share = budget > 0 ? Math.min(1, used / budget) : 0;
  const nearFull = share >= NEAR_FULL;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const bounds = triggerRef.current.getBoundingClientRect();
    setTooltipLeft(bounds.left + bounds.width / 2);
  }, [open]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!open || tooltipLeft === null || !tooltip) return;
    const half = tooltip.offsetWidth / 2;
    const left = Math.min(
      window.innerWidth - TOOLTIP_MARGIN - half,
      Math.max(TOOLTIP_MARGIN + half, tooltipLeft),
    );
    if (Math.abs(left - tooltipLeft) > 0.5) setTooltipLeft(left);
  }, [open, tooltipLeft]);

  return (
    <span
      ref={triggerRef}
      className="relative flex shrink-0 items-center gap-1 px-0.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-foreground/[0.12]"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          className={cn(
            'transition-all duration-500 ease-out',
            nearFull ? 'stroke-primary' : 'stroke-muted-foreground/50',
          )}
        />
      </svg>

      {nearFull && (
        <span className="font-mono text-[10px] tabular-nums text-primary">
          {Math.round(share * 100)}%
        </span>
      )}

      {open && tooltipLeft !== null && createPortal(
        <span
          ref={tooltipRef}
          style={{
            left: tooltipLeft,
            bottom: window.innerHeight - (triggerRef.current?.getBoundingClientRect().top ?? 0) + 8,
          }}
          className="context-tooltip pointer-events-none fixed z-[9999] w-max -translate-x-1/2 rounded-xl px-2.5 py-2 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150"
        >
          <span className="block whitespace-nowrap text-[10.5px] leading-5 text-muted-foreground">
            {t('agent.contextWindow')}
            <span className="ml-1.5 font-mono tabular-nums text-foreground">
              {compact(used)} / {compact(budget)}
            </span>
          </span>
          <span className="block whitespace-nowrap text-[10.5px] leading-5 text-muted-foreground">
            {t('agent.tokensSpent')}
            <span className="ml-1.5 font-mono tabular-nums text-foreground">{compact(spent)}</span>
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}
