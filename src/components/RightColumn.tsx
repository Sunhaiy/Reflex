import { SparklesIcon } from '@hugeicons/core-free-icons';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { AgentHeaderActions } from './agent/AgentHeaderActions';
import { AgentPanel } from './agent/AgentPanel';
import { useTranslation } from '../hooks/useTranslation';
import type { AgentController } from '../hooks/useAgent';

const RightPanel = lazy(() => import('./RightPanel').then((module) => ({ default: module.RightPanel })));

/**
 * Agent, monitor and Docker share one right-column tab bar. Agent actions belong to that
 * bar rather than the composer because they change the conversation, not the next prompt.
 */
export function RightColumn({ sessionId, active, agent }: {
  sessionId: string;
  active: boolean;
  agent: AgentController;
}) {
  const { t } = useTranslation();

  return (
    <ErrorBoundary name="RightPanel">
      <Suspense fallback={null}>
        <RightPanel
          connectionId={sessionId}
          active={active}
          extraTab={{
            id: 'agent',
            label: t('agent.title'),
            icon: SparklesIcon,
            content: <AgentPanel agent={agent} />,
            actions: <AgentHeaderActions agent={agent} />,
          }}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
