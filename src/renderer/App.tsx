import { useEffect } from "react";
import { useConnectionStore } from "@/stores/useConnectionStore";
import { TopBar } from "@/components/TopBar";
import { TitleBar } from "@/components/TitleBar";
import { Workspace } from "@/components/Workspace";
import { ConnectionManager } from "@/pages/ConnectionManager";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function App() {
  const { activeSessionId } = useConnectionStore();

  useEffect(() => {
    console.log('App mounted');
    if (!window.electron) {
      console.error('window.electron is undefined! Preload script might have failed.');
      // alert('System Error: IPC communication is not available. Please restart the application.');
    } else {
      console.log('IPC available');
    }
  }, []);

  return (
    <ErrorBoundary>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 border border-gray-600 dark:border-gray-800 rounded-lg shadow-2xl">
        {/* Custom Window Title Bar */}
        <TitleBar />
        
        {/* Connection Tabs */}
        <TopBar />

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {activeSessionId ? (
             <ErrorBoundary fallback={<div className="p-4 text-red-500">Workspace Error</div>}>
                <Workspace connectionId={activeSessionId} />
             </ErrorBoundary>
          ) : (
             <div className="flex-1 overflow-auto">
               <ErrorBoundary fallback={<div className="p-4 text-red-500">Connection Manager Error</div>}>
                  <ConnectionManager />
               </ErrorBoundary>
             </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}



