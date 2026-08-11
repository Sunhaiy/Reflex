import { useEffect, useState } from 'react';
import { DotMatrix } from '../dot-matrix';
import { useTranslation } from '../../hooks/useTranslation';

function formatElapsed(startedAt: number, now: number): string {
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const hours = Math.floor(elapsed / 3_600);
  const minutes = Math.floor((elapsed % 3_600) / 60);
  const seconds = elapsed % 60;
  const minutesAndSeconds = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${minutesAndSeconds}`
    : minutesAndSeconds;
}

export function AgentRunStatus({ startedAt }: { startedAt: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let interval = 0;
    const tick = () => setNow(Date.now());
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 1_000);
    }, 1_000 - (Date.now() % 1_000));

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex min-h-7 shrink-0 items-center gap-2 px-2.5 py-0.5 text-foreground">
      <DotMatrix
        state="syncing"
        label={t('agent.working')}
        className="size-3.5 text-foreground"
      />
      <time className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatElapsed(startedAt, now)}
      </time>
    </div>
  );
}
