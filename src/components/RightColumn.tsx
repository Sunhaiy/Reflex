import { SparklesIcon } from '@hugeicons/core-free-icons';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { AgentPanel } from './agent/AgentPanel';
import { useTranslation } from '../hooks/useTranslation';
import type { AgentController } from '../hooks/useAgent';

const RightPanel = lazy(() => import('./RightPanel').then((module) => ({ default: module.RightPanel })));

/**
 * The right column. When the agent is docked here it joins the monitor and Docker on
 * their own bar rather than getting a second row above them: the three are alternatives
 * for the same space, and two stacked bars read as two unrelated kinds of thing.
 */
export function RightColumn({ sessionId, active, agent, agentDocked }: {
  sessionId: string;
  active: boolean;
  agent: AgentController;
  agentDocked: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ErrorBoundary name="RightPanel">
      <Suspense fallback={null}>
        <RightPanel
          connectionId={sessionId}
          active={active}
          extraTab={agentDocked ? {
            id: 'agent',
            label: t('agent.title'),
            icon: SparklesIcon,
            content: <AgentPanel agent={agent} />,
          } : undefined}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
