import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ComputerIcon, ContainerIcon } from "@hugeicons/core-free-icons";
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { ErrorBoundary } from './ErrorBoundary';
import { workspaceBarClass, workspaceTabClass } from './workspaceChrome';

const SystemMonitor = lazy(() => import('./SystemMonitor').then((module) => ({ default: module.SystemMonitor })));
const DockerManager = lazy(() => import('./DockerManager').then((module) => ({ default: module.DockerManager })));

interface RightPanelProps {
  connectionId: string;
  /** False while this session sits behind another tab; polling pauses, state stays. */
  active: boolean;
  /**
   * An extra pane sharing this bar. The agent docks here rather than growing a second row
   * of tabs above these — two bars for three destinations reads as two unrelated things.
   */
  extraTab?: { id: string; label: string; icon: IconSvgElement; content: React.ReactNode };
}

export function RightPanel({ connectionId, active, extraTab }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState('monitor');
  const { t } = useTranslation();

  const tabs = [
    { id: 'monitor', label: t('processList.title'), icon: ComputerIcon },
    { id: 'docker', label: 'Docker', icon: ContainerIcon },
    ...(extraTab ? [{ id: extraTab.id, label: extraTab.label, icon: extraTab.icon }] : []),
  ];
  // A tab that disappears must not take the view with it.
  const showing = tabs.some((tab) => tab.id === activeTab) ? activeTab : 'monitor';

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className={cn(workspaceBarClass, 'no-scrollbar gap-1 overflow-x-auto px-2')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              workspaceTabClass,
              'whitespace-nowrap',
              showing === tab.id && 'bg-foreground/[0.09] text-foreground',
            )}
          >
            <HugeiconsIcon icon={tab.icon} className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hidden rather than unmounted: the monitor collects its history as it runs, and
          tearing it down to look at Docker meant coming back to empty charts. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ display: showing === 'monitor' ? 'block' : 'none' }}>
          <ErrorBoundary name="SystemMonitor">
            <Suspense fallback={null}>
              <SystemMonitor connectionId={connectionId} active={active && showing === 'monitor'} />
            </Suspense>
          </ErrorBoundary>
        </div>

        <div className="absolute inset-0" style={{ display: showing === 'docker' ? 'block' : 'none' }}>
          <ErrorBoundary name="DockerManager">
            <Suspense fallback={null}>
              <DockerManager connectionId={connectionId} />
            </Suspense>
          </ErrorBoundary>
        </div>

        {extraTab && (
          <div className="absolute inset-0" style={{ display: showing === extraTab.id ? 'block' : 'none' }}>
            {extraTab.content}
          </div>
        )}
      </div>
    </div>
  );
}
