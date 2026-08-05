import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon, Download01Icon, FolderOpenIcon, GithubIcon, Loading02Icon, Refresh01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';

import { Select } from '../../components/ui/select';

import { LANGUAGE_NAMES, type Language } from '../../shared/locales';

import { useSettingsStore } from '../../store/settingsStore';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { FieldLabel, SettingsCard, ToggleSwitch } from './controls';

// Built from the locale registry, so a new language appears here by shipping its
// bundle rather than by remembering to extend a second hardcoded list.
const languageOptions = (Object.keys(LANGUAGE_NAMES) as Language[])
  .map((code) => ({ label: LANGUAGE_NAMES[code], value: code }));

export function AppTab() {
  const { t } = useTranslation();
  const { language, setLanguage, autoReconnect, setAutoReconnect } = useSettingsStore();
  const [appVersion, setAppVersion] = useState('');
  const { state: update, check: checkForUpdates, apply: applyUpdate } = useAppUpdate();

  // Read here rather than in the shell: this tab is the only thing that shows it.
  useEffect(() => {
    window.electron.getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  return (

    <div className="space-y-3">
      <SettingsCard
        title={t('settings.tabs.app')}
        description={t('settings.appearance.languageDesc')}
      >
        <div className="flex items-center justify-between gap-6">
          <FieldLabel title={t('settings.application.restoreLast')} description={t('settings.application.restoreLastDesc')} />
          <ToggleSwitch checked={autoReconnect} onChange={setAutoReconnect} />
        </div>
        <div className="grid grid-cols-[1fr_220px] items-center gap-6 border-t border-border/45 pt-5">
          <FieldLabel title={t('settings.appearance.language')} />
          <Select value={language} onChange={(value) => setLanguage(value as Language)} options={languageOptions} />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.application.updateTitle')}
        description={update.automatic
          ? t('settings.application.automaticUpdateDesc')
          : t('settings.application.manualUpdateModeDesc')}
      >
        <div className="flex items-center justify-between gap-5">
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {update.phase === 'available'
                ? t('settings.application.updateAvailableVersion', { version: update.availableVersion || '' })
                : update.phase === 'checking'
                  ? t('settings.application.checking')
                  : update.phase === 'downloading'
                    ? t('settings.application.downloading', { progress: Math.round(update.progress || 0) })
                    : update.phase === 'ready'
                      ? t('settings.application.restarting')
                      : update.phase === 'up-to-date'
                        ? t('settings.application.upToDate')
                        : update.phase === 'error'
                          ? t('settings.application.updateFailed')
                          : t('settings.application.currentVersion', { version: update.currentVersion || appVersion })}
            </div>
            {update.phase === 'available' && !update.automatic && (
              <div className="mt-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
                {t('settings.application.recommendedFile', { file: update.fileName || 'GitHub Release' })}
              </div>
            )}
            {update.phase === 'error' && update.error && (
              <div className="mt-1 break-words text-[10px] leading-4 text-rose-400">{update.error}</div>
            )}
          </div>
          {update.phase === 'available' ? (
            <Button className="shrink-0 gap-2" onClick={() => void applyUpdate()}>
              <HugeiconsIcon icon={Download01Icon} className="h-4 w-4" />
              {update.automatic
                ? t('settings.application.updateNow')
                : t('settings.application.downloadFile', { file: update.fileName || 'DMG' })}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="shrink-0 gap-2"
              disabled={update.phase === 'checking' || update.phase === 'downloading' || update.phase === 'ready'}
              onClick={() => void checkForUpdates()}
            >
              <HugeiconsIcon
                icon={update.phase === 'up-to-date' ? Tick02Icon : update.phase === 'checking' ? Loading02Icon : Refresh01Icon}
                className={update.phase === 'checking' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              {update.phase === 'checking' ? t('settings.application.checking') : t('settings.application.checkUpdate')}
            </Button>
          )}
        </div>
        {update.phase === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${update.progress || 0}%` }} />
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Reflex"
        description={t('settings.about.title')}
      >
        <div className="flex items-center gap-4 rounded-2xl border border-border/55 bg-background/38 p-4">
          <img src={`${import.meta.env.BASE_URL}tray-icon.png`} alt="Reflex" className="h-12 w-12 rounded-2xl border border-border/60 object-cover" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Reflex {appVersion}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('boot.tagline')}</div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/55">Electron · React · Shadcn tokens · Hugeicons</div>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => window.electron.openExternal('https://github.com/Sunhaiy/Reflex')}>
            <HugeiconsIcon icon={GithubIcon} className="h-4 w-4" />
            GitHub
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-5 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.about.logs')} description={t('settings.about.logsDesc')} />
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => void window.electron.logReveal()}>
            <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
            {t('settings.about.openLogs')}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
