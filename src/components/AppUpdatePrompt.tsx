import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Download01Icon, Loading02Icon, Refresh01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from './ui/button';

export function AppUpdatePrompt() {
  const { state, check, apply } = useAppUpdate();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state.phase === 'available' || state.phase === 'error') setDismissed(false);
  }, [state.availableVersion, state.error, state.phase]);

  if (dismissed || !['available', 'downloading', 'ready', 'error'].includes(state.phase)) return null;

  const manual = state.phase === 'available' && !state.automatic;
  const busy = state.phase === 'downloading' || state.phase === 'ready';
  const title = state.phase === 'error'
    ? t('settings.application.updateFailed')
    : state.phase === 'ready'
      ? t('settings.application.restarting')
      : state.phase === 'downloading'
        ? t('settings.application.downloading', { progress: Math.round(state.progress || 0) })
        : t('settings.application.updateAvailable');
  const description = state.phase === 'error'
    ? state.error || t('settings.application.updateFailedDesc')
    : manual
      ? t('settings.application.manualUpdateDesc', { file: state.fileName || 'GitHub Release' })
      : t('settings.application.updateAvailableDesc', { version: state.availableVersion || '' });

  const handleApply = async () => {
    const opened = await apply();
    if (manual && opened) setDismissed(true);
  };

  return (
    <aside className="glass-panel fixed bottom-5 right-5 z-[80] w-[min(390px,calc(100vw-40px))] overflow-hidden rounded-2xl shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/14 text-primary">
          <HugeiconsIcon icon={busy ? Loading02Icon : state.phase === 'error' ? Refresh01Icon : Download01Icon} className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{description}</p>
          {state.phase === 'downloading' && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${state.progress || 0}%` }} />
            </div>
          )}
          {(state.phase === 'available' || state.phase === 'error') && (
            <Button size="sm" className="mt-3 gap-2" onClick={() => void (state.phase === 'error' ? check() : handleApply())}>
              <HugeiconsIcon icon={state.phase === 'error' ? Refresh01Icon : Download01Icon} className="h-3.5 w-3.5" />
              {state.phase === 'error'
                ? t('settings.application.retry')
                : manual
                  ? t('settings.application.downloadFile', { file: state.fileName || 'DMG' })
                  : t('settings.application.updateNow')}
            </Button>
          )}
        </div>
        {!busy && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
            aria-label={t('common.close')}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
}
