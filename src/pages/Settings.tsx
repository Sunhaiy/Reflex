import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ComputerTerminal01Icon,
  PaintBoardIcon,
  Settings01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';
import { AppearanceTab } from './settings/AppearanceTab';
import { AppTab } from './settings/AppTab';
import { AgentTab } from './settings/AgentTab';
import { TerminalTab } from './settings/TerminalTab';

type SettingsTab = 'app' | 'appearance' | 'terminal' | 'agent';

export function Settings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const copy = {
    title: t('settings.title'),
    app: t('settings.tabs.app'),
    appearance: t('settings.tabs.appearance'),
    terminal: t('settings.tabs.terminal'),
    agent: t('settings.tabs.agent'),
  };
  const tabs: Array<{
    id: SettingsTab;
    label: string;
    description: string;
    icon: IconSvgElement;
  }> = [
    { id: 'app', label: copy.app, description: '', icon: Settings01Icon },
    { id: 'appearance', label: copy.appearance, description: '', icon: PaintBoardIcon },
    {
      id: 'terminal',
      label: copy.terminal,
      description: t('settings.terminal.fontFamilyDesc'),
      icon: ComputerTerminal01Icon,
    },
    {
      id: 'agent',
      label: copy.agent,
      description: t('settings.agent.desc'),
      icon: SparklesIcon,
    },
  ];
  const active = tabs.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex h-full min-w-0 gap-2 overflow-hidden p-2">
      <aside className="glass-panel flex w-[196px] shrink-0 flex-col rounded-2xl border-border/65 bg-card/72 px-2 py-3">
        <div className="px-2 pb-3">
          <div className="text-sm font-semibold tracking-tight">{copy.title}</div>
        </div>

        <nav aria-label={copy.title}>
          <div className="space-y-1">
            {tabs.map((tab) => {
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
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      selected
                        ? 'text-foreground'
                        : 'text-muted-foreground group-hover:text-foreground',
                    )}
                    strokeWidth={1.8}
                  />
                  <span className="truncate text-[13px] font-medium tracking-[-0.01em]">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em]">{active.label}</h2>
              {active.description && (
                <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>
              )}
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
