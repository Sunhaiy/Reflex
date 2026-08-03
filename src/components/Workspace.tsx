import { lazy, Suspense } from 'react';
import { TerminalConnecting } from './ConnectingOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import { ResizableLayout } from './ResizableLayout';
import { AgentDock } from './agent/AgentDock';
import type { SessionStatus } from '../shared/types';

const RightPanel = lazy(() => import('./RightPanel').then((module) => ({ default: module.RightPanel })));
const FileBrowser = lazy(() => import('./FileBrowser').then((module) => ({ default: module.FileBrowser })));
const TerminalView = lazy(() => import('./TerminalView').then((module) => ({ default: module.TerminalView })));

interface WorkspaceProps {
  sessionId: string;
  /** What the connection is called, so the agent can name it back. */
  serverLabel: string;
  status: SessionStatus;
  /** False while another tab is in front; the panes stay mounted regardless. */
  active: boolean;
}

/**
 * One session's three panes. Rendered for every open session and hidden with `display`
 * rather than unmounted: tearing these down on a tab switch dropped the terminal's
 * scrollback and the monitor's collected history, so switching back meant a reload.
 */
export function Workspace({ sessionId, serverLabel, status, active }: WorkspaceProps) {
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
              {/* The agent shares this column with the terminal rather than taking one of
                  its own: the two are read together, and the charts keep their width. */}
              <AgentDock sessionId={sessionId} serverLabel={serverLabel}>
                <ErrorBoundary name="Terminal">
                  <Suspense fallback={null}>
                    <TerminalView connectionId={sessionId} />
                  </Suspense>
                </ErrorBoundary>
              </AgentDock>
              {status === 'connecting' && <TerminalConnecting connectionId={sessionId} />}
            </div>
          }
          rightContent={
            <ErrorBoundary name="RightPanel">
              <Suspense fallback={null}>
                {/* Gated on 'connected', not merely visible: starting a sampling cycle
                    against a session still handshaking fails outright and then sits out
                    the whole interval before trying again. */}
                <RightPanel connectionId={sessionId} active={active && status === 'connected'} />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </div>
    </div>
  );
}
