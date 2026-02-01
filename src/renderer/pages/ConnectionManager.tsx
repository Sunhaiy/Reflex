import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/useConnectionStore';
import { SSHConnection } from '@shared/types';
import { Plus, Trash2, Server, Key, Lock } from 'lucide-react';

export function ConnectionManager() {
  const { connections, loadConnections, addConnection, removeConnection, setActiveSession } = useConnectionStore();
  const [isAdding, setIsAdding] = useState(false);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<SSHConnection>>({
    port: 22,
    authType: 'password'
  });

  useEffect(() => {
    loadConnections();
  }, []);

  const handleConnect = async (connection: SSHConnection) => {
    setIsConnecting(connection.id);
    try {
      const result = await window.electron.connectSSH(connection);
      if (result.success) {
        // Set active session instead of navigating
        setActiveSession(connection.id);
      } else {
        alert('Connection failed: ' + result.error);
      }
    } catch (error: any) {
      alert('Connection error: ' + error.message);
    } finally {
      setIsConnecting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Submitting form:', formData);
    if (!formData.name || !formData.host || !formData.username) {
      console.warn('Missing required fields');
      return;
    }
    
    const newConnection: SSHConnection = {
      id: crypto.randomUUID(),
      name: formData.name,
      host: formData.host,
      port: formData.port || 22,
      username: formData.username,
      authType: formData.authType as 'password' | 'key',
      password: formData.password,
      privateKeyPath: formData.privateKeyPath
    };
    
    console.log('Adding connection:', newConnection);
    try {
      await addConnection(newConnection);
      console.log('Connection added successfully');
      setIsAdding(false);
      setFormData({ port: 22, authType: 'password' });
    } catch (error) {
      console.error('Failed to add connection:', error);
      alert('Failed to save connection: ' + (error as any).message);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold tracking-tight">Connections</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Connection
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {connections.map(conn => (
          <div key={conn.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-gray-500" />
                <h3 className="font-semibold text-lg">{conn.name}</h3>
              </div>
              <button
                onClick={() => removeConnection(conn.id)}
                className="text-red-500 hover:text-red-700 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm text-gray-500 mb-4">
              {conn.username}@{conn.host}:{conn.port}
            </div>
            <button 
              onClick={() => handleConnect(conn)}
              disabled={isConnecting === conn.id}
              className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {isConnecting === conn.id ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        ))}
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-md shadow-lg border dark:border-gray-800">
            <h3 className="text-xl font-bold mb-4">New Connection</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  value={formData.name || ''}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="Production Server"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Host</label>
                  <input
                    className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    value={formData.host || ''}
                    onChange={e => setFormData({...formData, host: e.target.value})}
                    placeholder="192.168.1.1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Port</label>
                  <input
                    type="number"
                    className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    value={formData.port}
                    onChange={e => setFormData({...formData, port: parseInt(e.target.value)})}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <input
                  className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  value={formData.username || ''}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                  placeholder="root"
                  required
                />
              </div>
              
              <div>
                 <label className="block text-sm font-medium mb-1">Auth Type</label>
                 <div className="flex gap-4">
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input 
                       type="radio" 
                       name="authType"
                       checked={formData.authType === 'password'}
                       onChange={() => setFormData({...formData, authType: 'password'})}
                     />
                     <Lock className="w-4 h-4" /> Password
                   </label>
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input 
                       type="radio" 
                       name="authType"
                       checked={formData.authType === 'key'}
                       onChange={() => setFormData({...formData, authType: 'key'})}
                     />
                     <Key className="w-4 h-4" /> Key
                   </label>
                 </div>
              </div>

              {formData.authType === 'password' ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    value={formData.password || ''}
                    onChange={e => setFormData({...formData, password: e.target.value})}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Private Key Path</label>
                  <input
                    className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    value={formData.privateKeyPath || ''}
                    onChange={e => setFormData({...formData, privateKeyPath: e.target.value})}
                    placeholder="/path/to/id_rsa"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
