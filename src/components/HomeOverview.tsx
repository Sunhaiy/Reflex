import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';
import type { UsageStats } from '../shared/types';

/** Weeks of history in the strip; 7 rows of this many columns. */
const WEEKS = 15;

function formatDuration(ms: number, t: (key: string, values?: Record<string, string | number>) => string) {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return t('home.durationHm', { hours, minutes });
  if (minutes > 0) return t('home.durationM', { minutes });
  return t('home.durationM', { minutes: 0 });
}

/** Matches the key format usage.ts writes, in local time. */
function dayKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Builds the grid back from the most recent Sunday so columns line up as whole weeks,
 * the way a contribution graph reads.
 */
function buildDays(activityByDay: Record<string, number>) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const cells: Array<{ key: string; count: number; future: boolean }> = [];
  for (let index = WEEKS * 7 - 1; index >= 0; index -= 1) {
    const date = new Date(end);
    date.setDate(date.getDate() - index);
    const key = dayKey(date);
    cells.push({ key, count: activityByDay[key] ?? 0, future: date > today });
  }
  return cells;
}

export function HomeOverview() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    window.electron.usageGet().then(setUsage).catch(() => undefined);
  }, []);

  const cells = useMemo(() => buildDays(usage?.activityByDay ?? {}), [usage]);
  // Scaled against the busiest day rather than a fixed ceiling, so the strip reads the
  // same whether this install sees ten events a day or ten thousand.
  const peak = useMemo(() => Math.max(1, ...cells.map((cell) => cell.count)), [cells]);

  if (!usage) return null;

  // Server and connected counts are not here: both are visible in the grid directly
  // below, and restating them turned the band into a summary of the page rather than
  // of the usage it is meant to show.
  const stats = [
    { label: t('home.statTotalTime'), value: formatDuration(usage.totalConnectedMs, t) },
    { label: t('home.statConnections'), value: String(usage.successfulConnections) },
    { label: t('home.statLongest'), value: formatDuration(usage.longestConnectionMs, t) },
  ];

  return (
    <section className="mb-9 flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-[calc(20px*var(--radius-scale))] border border-border/55 bg-card/30 px-6 py-5">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
            <div className="mt-1.5 text-[17px] font-semibold tabular-nums tracking-tight">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
          role="img"
          aria-label={t('home.activityRecent', { weeks: WEEKS })}
        >
          {cells.map((cell) => (
            <span
              key={cell.key}
              title={cell.future ? undefined : `${cell.key} · ${cell.count}`}
              className={cn(
                'h-[9px] w-[9px] rounded-[2px]',
                cell.future && 'opacity-0',
              )}
              style={cell.future ? undefined : {
                backgroundColor: cell.count === 0
                  ? 'hsl(var(--foreground) / 0.06)'
                  : `hsl(var(--primary) / ${(0.25 + 0.75 * Math.min(1, cell.count / peak)).toFixed(2)})`,
              }}
            />
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">{t('home.activityRecent', { weeks: WEEKS })}</div>
      </div>
    </section>
  );
}
