import { lazy, Suspense, useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { ErrorBoundary } from './ErrorBoundary';
import { AgentPanel } from './agent/AgentPanel';
import { useTranslation } from '../hooks/useTranslation';
import type { AgentController } from '../hooks/useAgent';

const RightPanel = lazy(() => import('./RightPanel').then((module) => ({ default: module.RightPanel })));

/**
 * The charts, plus the agent when it is docked here.
 *
 * Both stay mounted and are hidden with `display`: tearing the charts down to show the
 * agent would restart their collection, which is the thing that made switching tabs feel
 * like a reload before.
 */
export function RightColumn({ sessionId, active, agent, agentDocked }: {
  sessionId: string;
  active: boolean;
  agent: AgentController;
  agentDocked: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'charts' | 'agent'>('charts');
  const showing = agentDocked ? tab : 'charts';

  // Moving the panel here should reveal it. Without this it lands behind the charts tab
  // and reads as though the move lost it.
  useEffect(() => {
    if (agentDocked) setTab('agent');
  }, [agentDocked]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {agentDocked && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-border/45 p-1">
          {(['charts', 'agent'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              className={cn(
                'h-6 flex-1 rounded-md text-[10.5px] font-medium transition-colors',
                showing === option
                  ? 'bg-foreground/[0.09] text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'charts' ? t('agent.tabCharts') : t('agent.title')}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1" style={{ display: showing === 'charts' ? 'block' : 'none' }}>
        <ErrorBoundary name="RightPanel">
          <Suspense fallback={null}>
            {/* Gated on being connected, not merely visible: a sampling cycle started
                against a session still handshaking fails and then sits out the interval. */}
            <RightPanel connectionId={sessionId} active={active && showing === 'charts'} />
          </Suspense>
        </ErrorBoundary>
      </div>

      {agentDocked && (
        <div className="min-h-0 flex-1" style={{ display: showing === 'agent' ? 'block' : 'none' }}>
          <AgentPanel agent={agent} />
        </div>
      )}
    </div>
  );
}
