import { useEffect, useState } from 'react';
import { SystemStats } from '@shared/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SystemMonitorProps {
  connectionId: string;
}

interface ExtendedInfo {
  os: string;
  cpu: {
    model: string;
    cores: number;
    frequency: string;
  };
  network: {
    localIp: string;
    publicIp: string;
    location: string;
  };
}

export function SystemMonitor({ connectionId }: SystemMonitorProps) {
  const [statsHistory, setStatsHistory] = useState<{ time: string; cpu: number; memory: number }[]>([]);
  const [currentStats, setCurrentStats] = useState<SystemStats | null>(null);
  const [systemInfo, setSystemInfo] = useState<ExtendedInfo | null>(null);

  useEffect(() => {
    if (!connectionId) return;

    // Start real-time monitoring
    if (window.electron && window.electron.startMonitoring) {
        window.electron.startMonitoring(connectionId);
    }
    
    // Fetch static system info once
    if (window.electron && window.electron.getSystemInfo) {
        window.electron.getSystemInfo(connectionId).then((info: any) => {
          if (!info.error) {
            setSystemInfo(info);
          } else {
             console.error('System info error:', info.error);
          }
        }).catch((err: any) => {
             console.error('Failed to get system info:', err);
        });
    }

    setStatsHistory([]);
    setCurrentStats(null);

    let cleanup = () => {};
    if (window.electron && window.electron.onStatsUpdate) {
         cleanup = window.electron.onStatsUpdate((event, { id, stats }) => {
          if (id === connectionId) {
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
    }

    return () => {
      cleanup();
      if (window.electron && window.electron.stopMonitoring) {
        window.electron.stopMonitoring(connectionId);
      }
    };
  }, [connectionId]);

  if (!connectionId) {
    return (
        <div className="flex h-full bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 shadow-sm items-center justify-center text-gray-400 text-sm">
            Waiting for connection stats...
        </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2">
       {/* Top: Info Panel */}
       <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border dark:border-gray-800 shadow-sm text-sm">
          <h3 className="font-bold mb-3 text-lg border-b pb-1 dark:border-gray-700">System Info</h3>
          
          <div className="space-y-3">
             <div>
                <span className="text-gray-500 block text-xs uppercase">OS</span>
                <span className="font-medium break-words">{systemInfo?.os || 'Loading...'}</span>
             </div>
             
             <div>
                <span className="text-gray-500 block text-xs uppercase">CPU</span>
                <div className="font-medium break-words">{systemInfo?.cpu?.model || 'Loading...'}</div>
                <div className="text-xs text-gray-500">
                   {systemInfo?.cpu ? `${systemInfo.cpu.cores} Cores @ ${systemInfo.cpu.frequency}MHz` : ''}
                </div>
             </div>
             
             <div>
                <span className="text-gray-500 block text-xs uppercase">Memory</span>
                <div className="font-medium">
                   {currentStats ? `${currentStats.memory.used}MB / ${currentStats.memory.total}MB` : 'Loading...'}
                </div>
                <div className="text-xs text-gray-500">
                   {currentStats ? `${currentStats.memory.percentage}% Used` : ''}
                </div>
             </div>

             <div>
                <span className="text-gray-500 block text-xs uppercase">Network</span>
                <div className="flex flex-col gap-1">
                   <div className="flex justify-between">
                      <span className="text-xs text-gray-400">Local IP: </span>
                      <span className="text-right">{systemInfo?.network?.localIp || '...'}</span>
                   </div>
                   <div className="flex justify-between">
                      <span className="text-xs text-gray-400">Public IP: </span>
                      <span className="text-right">{systemInfo?.network?.publicIp || '...'}</span>
                   </div>
                   <div className="flex flex-col mt-1">
                      <span className="text-xs text-gray-400">Location: </span>
                      <span className="break-words">{systemInfo?.network?.location || '...'}</span>
                   </div>
                </div>
             </div>
          </div>
       </div>

       {/* Bottom: Graphs */}
       <div className="flex-1 bg-white dark:bg-gray-900 p-2 rounded-lg border dark:border-gray-800 shadow-sm flex flex-col overflow-hidden">
          <h3 className="text-xs font-semibold mb-1 text-gray-500 uppercase">Real-time Load</h3>
          <div className="flex-1 min-h-0">
            {statsHistory.length > 0 && currentStats ? (
                <ResponsiveContainer width="100%" height="100%">
                <LineChart data={statsHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={10} width={25} />
                    <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    labelStyle={{ color: '#9ca3af' }}
                    />
                    <Line type="monotone" dataKey="cpu" stroke="#8884d8" strokeWidth={2} isAnimationActive={false} dot={false} name="CPU %" />
                    <Line type="monotone" dataKey="memory" stroke="#82ca9d" strokeWidth={2} isAnimationActive={false} dot={false} name="MEM %" />
                </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-400">
                    Collecting data...
                </div>
            )}
          </div>
       </div>
    </div>
  );
}
