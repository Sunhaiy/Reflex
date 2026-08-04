import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';

/** Past this the ring takes the theme colour: compaction is close, not hypothetical. */
const NEAR_FULL = 0.7;

const SIZE = 18;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How full the context is, as a ring.
 *
 * A number alone did not say whether it was a lot; a ring does at a glance. It fills with
 * the measured token count the endpoint reported for the last request, turns the theme
 * colour as it approaches the budget, and drops back on its own when the history is
 * compacted — so what the agent is doing to stay inside the window is visible rather than
 * inferred from output going missing.
 */
export function ContextRing({ used, budget }: { used: number; budget: number }) {
  const { t } = useTranslation();
  const share = budget > 0 ? Math.min(1, used / budget) : 0;
  const nearFull = share >= NEAR_FULL;

  return (
    <span
      title={t('agent.contextTitle', {
        used: used.toLocaleString(),
        budget: budget.toLocaleString(),
      })}
      className="flex shrink-0 items-center gap-1 px-0.5"
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
            'transition-all duration-500',
            nearFull ? 'stroke-primary' : 'stroke-muted-foreground/50',
          )}
        />
      </svg>

      {nearFull && (
        <span className="font-mono text-[10px] tabular-nums text-primary">
          {Math.round(share * 100)}%
        </span>
      )}
    </span>
  );
}
