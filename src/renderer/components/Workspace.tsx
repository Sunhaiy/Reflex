import { FileBrowser } from './FileBrowser';
import { SystemMonitor } from './SystemMonitor';
import { TerminalView } from './TerminalView';
import { ErrorBoundary } from './ErrorBoundary';

interface WorkspaceProps {
  connectionId: string;
}

export function Workspace({ connectionId }: WorkspaceProps) {
  return (
    <div className="flex-1 flex overflow-hidden bg-gray-100 dark:bg-gray-950 p-2 gap-2">
      {/* Left: File System */}
      <div className="w-[250px] flex-shrink-0 flex flex-col">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg text-red-500">FileBrowser Error</div>}>
           <FileBrowser connectionId={connectionId} />
        </ErrorBoundary>
      </div>

      {/* Middle: Terminal (Main Focus) */}
      <div className="flex-1 flex flex-col min-w-0">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-red-500">TerminalView Error</div>}>
           <TerminalView connectionId={connectionId} />
        </ErrorBoundary>
      </div>

      {/* Right: Monitor Panel */}
      <div className="w-[300px] flex-shrink-0 flex flex-col">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg text-red-500">SystemMonitor Error</div>}>
           <SystemMonitor connectionId={connectionId} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
