import { lazy, Suspense, useState } from 'react';
import { Container, Monitor } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { ErrorBoundary } from './ErrorBoundary';

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
      <div className="no-scrollbar flex items-center overflow-x-auto border-b border-border bg-muted/40 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('monitor')}
          className={`flex items-center gap-2 whitespace-nowrap border-r border-border px-3 py-2 transition-colors hover:bg-muted/30 ${activeTab === 'monitor'
            ? '-mb-px border-b-2 border-b-primary bg-transparent font-medium text-foreground'
            : 'text-muted-foreground'
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          {t('processList.title')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('docker')}
          className={`flex items-center gap-2 whitespace-nowrap border-r border-border px-3 py-2 transition-colors hover:bg-muted/30 ${activeTab === 'docker'
            ? '-mb-px border-b-2 border-b-primary bg-transparent font-medium text-foreground'
            : 'text-muted-foreground'
          }`}
        >
          <Container className="h-3.5 w-3.5" />
          Docker
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${activeTab === 'monitor' ? 'block' : 'hidden'}`}>
          <ErrorBoundary name="SystemMonitor">
            <Suspense fallback={null}>
              <SystemMonitor connectionId={connectionId} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className={`absolute inset-0 ${activeTab === 'docker' ? 'block' : 'hidden'}`}>
          <ErrorBoundary name="DockerManager">
            <Suspense fallback={null}>
              <DockerManager connectionId={connectionId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
