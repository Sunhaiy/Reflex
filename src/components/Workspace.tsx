import { lazy, Suspense } from 'react';
import { TerminalConnecting } from './ConnectingOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import { ResizableLayout } from './ResizableLayout';
import { RightColumn } from './RightColumn';
import { useAgent } from '../hooks/useAgent';
import type { SessionStatus } from '../shared/types';

const FileBrowser = lazy(() => import('./FileBrowser').then((module) => ({ default: module.FileBrowser })));
const TerminalView = lazy(() => import('./TerminalView').then((module) => ({ default: module.TerminalView })));

interface WorkspaceProps {
  sessionId: string;
  /** Stable across app restarts, unlike the live SSH session id. */
  connectionId: string;
  /** What the connection is called, so the agent can name it back. */
  serverLabel: string;
  status: SessionStatus;
  /** False while another tab is in front; the panes stay mounted regardless. */
  active: boolean;
}

/**
 * One session's panes. Rendered for every open session and hidden with `display` rather
 * than unmounted: tearing these down on a tab switch dropped the terminal's scrollback and
 * the monitor's collected history, so switching back meant a reload.
 *
 * The agent's state is held here rather than inside its panel so changing right-column
 * tabs never resets its conversations.
 */
export function Workspace({ sessionId, connectionId, serverLabel, status, active }: WorkspaceProps) {
  const agent = useAgent(sessionId, connectionId, serverLabel);

  const terminal = (
    <ErrorBoundary name="Terminal">
      <Suspense fallback={null}>
        <TerminalView connectionId={sessionId} />
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{ display: active ? 'flex' : 'none' }}
    >
      <div className="min-h-0 flex-1">
        <ResizableLayout
          leftContent={
            <ErrorBoundary name="FileBrowser">
              <Suspense fallback={null}>
                <FileBrowser connectionId={sessionId} isConnected={status === 'connected'} />
              </Suspense>
            </ErrorBoundary>
          }
          middleContent={
            <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background/28">
              <div className="relative min-h-0 flex-1 overflow-hidden">{terminal}</div>
              {status === 'connecting' && <TerminalConnecting connectionId={sessionId} />}
            </div>
          }
          rightContent={
            <RightColumn
              sessionId={sessionId}
              active={active && status === 'connected'}
              agent={agent}
            />
          }
        />
      </div>
    </div>
  );
}
