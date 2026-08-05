import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon, FolderOpenIcon, GithubIcon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';

import { Select } from '../../components/ui/select';

import { LANGUAGE_NAMES, type Language } from '../../shared/locales';

import { useSettingsStore } from '../../store/settingsStore';
import { useTranslation } from '../../hooks/useTranslation';
import { FieldLabel, SettingsCard, ToggleSwitch } from './controls';

// Built from the locale registry, so a new language appears here by shipping its
// bundle rather than by remembering to extend a second hardcoded list.
const languageOptions = (Object.keys(LANGUAGE_NAMES) as Language[])
  .map((code) => ({ label: LANGUAGE_NAMES[code], value: code }));

export function AppTab() {
  const { t } = useTranslation();
  const { language, setLanguage, autoReconnect, setAutoReconnect } = useSettingsStore();
  const [appVersion, setAppVersion] = useState('');

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
