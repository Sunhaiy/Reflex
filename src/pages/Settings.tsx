import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ComputerTerminal01Icon, PaintBoardIcon, Settings01Icon, SparklesIcon } from '@hugeicons/core-free-icons';

import { useEffect, useState } from 'react';

import { cn } from '../lib/utils';

import type { Language } from '../shared/locales';

import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { useTranslation } from '../hooks/useTranslation';
import { loadAllFonts } from '../lib/fontLoader';
import { AppearanceTab } from './settings/AppearanceTab';
import { AppTab } from './settings/AppTab';
import { AgentTab } from './settings/AgentTab';
import { TerminalTab } from './settings/TerminalTab';

type SettingsTab = 'app' | 'appearance' | 'terminal' | 'agent';

export function Settings() {
  // The picker previews each option in its own typeface, so this is the moment
  // the families kept out of the startup path are actually needed.
  useEffect(() => loadAllFonts(), []);

  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [appVersion, setAppVersion] = useState('1.0.12');

  const {
    appearance,
    accentColorId,
    radiusScale,
    setAppearance,
    setAccentColor,
    setRadiusScale,
  } = useThemeStore();

  const {
    language,
    setLanguage,
    uiFontFamily,
    setUiFontFamily,
    terminalFontFamily,
    setTerminalFontFamily,
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    letterSpacing,
    setLetterSpacing,
    cursorStyle,
    setCursorStyle,
    cursorBlink,
    setCursorBlink,
    rendererType,
    setRendererType,
    scrollback,
    setScrollback,
    brightBold,
    setBrightBold,
    autoReconnect,
    setAutoReconnect,
  } = useSettingsStore();

  const copy = {
    title: t('settings.title'),
    app: t('settings.tabs.app'),
    appearance: t('settings.tabs.appearance'),
    terminal: t('settings.tabs.terminal'),
    agent: t('settings.tabs.agent'),
  };

  useEffect(() => {
    window.electron.getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: IconSvgElement }> = [
    { id: 'app', label: copy.app, description: '', icon: Settings01Icon },
    { id: 'appearance', label: copy.appearance, description: '', icon: PaintBoardIcon },
    { id: 'terminal', label: copy.terminal, description: t('settings.terminal.fontFamilyDesc'), icon: ComputerTerminal01Icon },
    { id: 'agent', label: copy.agent, description: t('settings.agent.desc'), icon: SparklesIcon },
  ];

  const tabGroups: Array<{ label: string; items: typeof tabs }> = [{ label: '', items: tabs }];

  const languageOptions = [
    { label: '中文', value: 'zh' },
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
    { label: '한국어', value: 'ko' },
    { label: 'Italiano', value: 'it' },
  ];

  const active = tabs.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex h-full min-w-0 gap-2 overflow-hidden p-2">
      <aside className="glass-panel flex w-[196px] shrink-0 flex-col rounded-2xl border-border/65 bg-card/72 px-2 py-3">
        <div className="px-2 pb-3">
          <div className="text-sm font-semibold tracking-tight">{copy.title}</div>
        </div>

        <nav aria-label={copy.title}>
          {tabGroups.map((group, groupIndex) => (
            <div
              key={group.label}
              className={cn(groupIndex > 0 && 'mt-2 border-t border-border/70 pt-3')}
            >
              {group.label && <div className="px-2 pb-1.5 text-[10px] font-medium text-muted-foreground">{group.label}</div>}
              <div className="space-y-1">
                {group.items.map((tab) => {
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'group flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors duration-150',
                        selected
                          ? 'bg-foreground/[0.09] text-foreground'
                          : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                      )}
                    >
                      <HugeiconsIcon
                        icon={tab.icon}
                        className={cn('h-4 w-4 shrink-0 transition-colors', selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}
                        strokeWidth={1.8}
                      />
                      <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em]">{active.label}</h2>
              {active.description && <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>}
            </div>
          </div>
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'terminal' && <TerminalTab />}
          {activeTab === 'app' && <AppTab />}
          {activeTab === 'agent' && <AgentTab />}
          <div className="h-4" />
        </div>
      </main>
    </div>
  );
}
