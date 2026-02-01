import { useConnectionStore } from '@/stores/useConnectionStore';
import { X, Plus, Terminal } from 'lucide-react';

export function TopBar() {
  const { connections, activeSessionId, setActiveSession, removeConnection } = useConnectionStore();
  
  // In a real app, we might want to track "open" sessions separate from "saved" connections.
  // For this simple version, we'll just list connections and highlight the active one.
  // Or better: Let's assume the user selects a connection from a dropdown or "Home" to "Open" it.
  // But per request "Top is switch connection", implying tabs or a switcher.
  
  // Let's implement a simple "Active Sessions" concept implicitly.
  // If activeSessionId is set, it means we are in "Connected" mode.
  // We can show a dropdown or list of available connections to switch to.
  
  const activeConnection = connections.find(c => c.id === activeSessionId);

  return (
    <div className="h-12 border-b dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-4 justify-between select-none">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-blue-600 font-bold mr-4">
          <Terminal className="w-5 h-5" />
          <span>SSH Tool</span>
        </div>
        
        {/* Connection Switcher / Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {connections.map(conn => (
            <button
              key={conn.id}
              onClick={() => setActiveSession(conn.id)}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors border
                ${activeSessionId === conn.id 
                  ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300' 
                  : 'bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}
              `}
            >
              <div className={`w-2 h-2 rounded-full ${activeSessionId === conn.id ? 'bg-green-500' : 'bg-gray-300'}`} />
              {conn.name}
            </button>
          ))}
          
          <button 
             onClick={() => setActiveSession(null)}
             className="ml-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-500"
             title="Manage Connections"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
          {/* Right side controls (Theme, etc) could go here */}
      </div>
    </div>
  );
}
