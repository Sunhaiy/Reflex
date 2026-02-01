import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/useConnectionStore';
import { SystemStats } from '@shared/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function ResourceMonitor() {
  const { connections, loadConnections } = useConnectionStore();
  const [selectedId, setSelectedId] = useState<string>('');
  const [statsHistory, setStatsHistory] = useState<{ time: string; cpu: number; memory: number }[]>([]);
  const [currentStats, setCurrentStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    window.electron.startMonitoring(selectedId);
    setStatsHistory([]);
    setCurrentStats(null);

    const cleanup = window.electron.onStatsUpdate((event, { id, stats }) => {
      if (id === selectedId) {
        setCurrentStats(stats);
        setStatsHistory(prev => {
          const newHistory = [...prev, { 
            time: new Date().toLocaleTimeString(), 
            cpu: stats.cpu, 
            memory: stats.memory.percentage 
          }];
          if (newHistory.length > 20) newHistory.shift();
          return newHistory;
        });
      }
    });

    return () => {
      cleanup();
      window.electron.stopMonitoring(selectedId);
    };
  }, [selectedId]);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold tracking-tight">System Resources</h2>
        <select 
          className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">Select Connection</option>
          {connections.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
          ))}
        </select>
      </div>

      {selectedId && (
        <div className="grid gap-6 md:grid-cols-2 h-full">
           <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border dark:border-gray-800 shadow-sm flex flex-col h-[400px]">
              <h3 className="text-lg font-semibold mb-4">CPU Usage ({currentStats?.cpu ?? 0}%)</h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={statsHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#9ca3af" />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    />
                    <Line type="monotone" dataKey="cpu" stroke="#8884d8" strokeWidth={2} isAnimationActive={false} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
           </div>

           <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border dark:border-gray-800 shadow-sm flex flex-col h-[400px]">
              <h3 className="text-lg font-semibold mb-4">Memory Usage ({currentStats?.memory.percentage ?? 0}%)</h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={statsHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#9ca3af" />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    />
                    <Line type="monotone" dataKey="memory" stroke="#82ca9d" strokeWidth={2} isAnimationActive={false} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-sm text-gray-500 text-center">
                 Used: {currentStats?.memory.used ?? 0}MB / Total: {currentStats?.memory.total ?? 0}MB
              </div>
           </div>
        </div>
      )}
      
      {!selectedId && (
        <div className="flex-1 flex items-center justify-center text-gray-500">
           Select a connection to view resources (Must be connected first)
        </div>
      )}
    </div>
  );
}
