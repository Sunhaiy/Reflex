import { useState, useEffect } from 'react';
import { SSHConnection } from '../shared/types';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ScrollArea } from '../components/ui/scroll-area';
import { Trash2, Play, Plus, Settings as SettingsIcon, Edit2, Server } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { Modal } from '../components/ui/modal';
import { ConnectionForm } from '../components/ConnectionForm';

interface ConnectionManagerProps {
  onConnect: (connection: SSHConnection) => void;
  onNavigate: (page: 'connections' | 'workspace' | 'settings') => void;
}

export function ConnectionManager({ onConnect, onNavigate }: ConnectionManagerProps) {
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [editingConnection, setEditingConnection] = useState<Partial<SSHConnection> | null>(null); // For Dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    const stored = await window.electron.storeGet('connections');
    if (stored) setConnections(stored);
  };

  const handleSave = async (data: SSHConnection) => {
    const username = data.username || 'root';
    const name = data.name || (data.host ? `${username}@${data.host}` : 'New Server');

    const newConnection: SSHConnection = {
      ...data,
      id: data.id || Date.now().toString(),
      name,
      username,
    };

    const newConnections = data.id
      ? connections.map(c => c.id === data.id ? newConnection : c)
      : [...connections, newConnection];

    setConnections(newConnections);
    await window.electron.storeSet('connections', newConnections);
    setIsModalOpen(false);
    setEditingConnection(null);
  };

  const deleteConnection = async (id: string) => {
    if (!confirm(t('common.delete') + '?')) return;
    const newConnections = connections.filter(c => c.id !== id);
    setConnections(newConnections);
    await window.electron.storeSet('connections', newConnections);
  };

  const openNewConnection = () => {
    setEditingConnection({});
    setIsModalOpen(true);
  };

  const openEditConnection = (conn: SSHConnection) => {
    setEditingConnection(conn);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">SSH Tool</h1>
        <Button variant="outline" size="icon" onClick={() => onNavigate('settings')}>
          <SettingsIcon className="w-5 h-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-6">
          {/* Add New Card */}
          <div
            onClick={openNewConnection}
            className="group relative flex flex-col items-center justify-center p-6 border-2 border-dashed border-muted-foreground/25 rounded-xl hover:border-primary/50 hover:bg-accent/50 cursor-pointer transition-all duration-200 min-h-[180px]"
          >
            <div className="rounded-full bg-accent p-4 group-hover:scale-110 transition-transform duration-200 mb-4">
              <Plus className="w-8 h-8 text-muted-foreground group-hover:text-primary" />
            </div>
            <span className="font-semibold text-muted-foreground group-hover:text-primary">{t('connection.new')}</span>
          </div>

          {/* Connection Cards */}
          {connections.map(c => (
            <Card key={c.id} className="group relative overflow-hidden border-muted/40 hover:border-primary/50 transition-all duration-200 hover:shadow-lg">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <Server className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-foreground/50 hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); openEditConnection(c); }} title={t('common.edit')}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); deleteConnection(c.id); }} title={t('common.delete')}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="mt-4 truncate text-lg pr-4" title={c.name}>{c.name}</CardTitle>
                <div className="text-sm text-muted-foreground truncate font-mono mt-1">
                  {c.username}@{c.host}
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <Button className="w-full gap-2 mt-2" onClick={() => onConnect(c)}>
                  <Play className="w-4 h-4" /> {t('common.connect')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingConnection?.id ? t('common.edit') : t('connection.new')}
      >
        <ConnectionForm
          initialData={editingConnection || {}}
          onSave={handleSave}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>
    </div>
  );
}

