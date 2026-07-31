import { HugeiconsIcon } from "@hugeicons/react";
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
}

export function RightPanel({ connectionId }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'monitor' | 'docker'>('monitor');
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className={cn(workspaceBarClass, 'no-scrollbar gap-1 overflow-x-auto px-2')}>
        <button
          type="button"
          onClick={() => setActiveTab('monitor')}
          className={cn(
            workspaceTabClass,
            'whitespace-nowrap',
            activeTab === 'monitor' && 'bg-foreground/[0.09] text-foreground'
          )}
        >
          <HugeiconsIcon icon={ComputerIcon} className="h-3.5 w-3.5" />
          {t('processList.title')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('docker')}
          className={cn(
            workspaceTabClass,
            'whitespace-nowrap',
            activeTab === 'docker' && 'bg-foreground/[0.09] text-foreground'
          )}
        >
          <HugeiconsIcon icon={ContainerIcon} className="h-3.5 w-3.5" />
          Docker
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {activeTab === 'monitor' ? (
          <div className="absolute inset-0">
            <ErrorBoundary name="SystemMonitor">
              <Suspense fallback={null}>
                <SystemMonitor connectionId={connectionId} />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : (
          <div className="absolute inset-0">
            <ErrorBoundary name="DockerManager">
              <Suspense fallback={null}>
                <DockerManager connectionId={connectionId} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
