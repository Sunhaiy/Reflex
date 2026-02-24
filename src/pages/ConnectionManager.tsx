import { useState, useEffect } from 'react';
import { SSHConnection } from '../shared/types';
import { Button } from '../components/ui/button';
import { Trash2, Plus, Edit2, Server, Zap, Globe, ArrowRight, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';
import { Modal } from '../components/ui/modal';
import { ConnectionForm } from '../components/ConnectionForm';
import { Input } from '../components/ui/input';

interface ConnectionManagerProps {
  onConnect: (connection: SSHConnection) => void;
  onNavigate: (page: 'connections' | 'workspace' | 'settings') => void;
  activeSessions?: number;
}

export function ConnectionManager({ onConnect, onNavigate, activeSessions = 0 }: ConnectionManagerProps) {
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [editingConnection, setEditingConnection] = useState<Partial<SSHConnection> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      if (!(window as any).electron) return;
      const stored = await (window as any).electron.storeGet('connections');
      if (stored) setConnections(stored);
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  };

  const handleSave = async (data: SSHConnection) => {
    const username = data.username || 'root';
    const name = data.name || (data.host ? `${username}@${data.host}` : 'New Server');
    const conn: SSHConnection = {
      ...data,
      id: data.id || Date.now().toString(),
      name,
      username,
    };
    const next = data.id
      ? connections.map(c => c.id === data.id ? conn : c)
      : [...connections, conn];
    setConnections(next);
    await (window as any).electron.storeSet('connections', next);
    setIsModalOpen(false);
    setEditingConnection(null);
  };

  const deleteConnection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('common.delete') + '?')) return;
    const next = connections.filter(c => c.id !== id);
    setConnections(next);
    await (window as any).electron.storeSet('connections', next);
  };

  const editConnection = (conn: SSHConnection, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConnection(conn);
    setIsModalOpen(true);
  };

  const filtered = filterQuery
    ? connections.filter(c =>
      c.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.host.toLowerCase().includes(filterQuery.toLowerCase())
    )
    : connections;

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 h-10 flex items-center gap-2 px-4 border-b border-border/40">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            placeholder={t('connection.name') + ' / Host...'}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-7 pl-8 text-xs bg-secondary/30 border-border/30"
          />
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground/50 mr-2">
          {connections.length} {connections.length === 1 ? 'server' : 'servers'}
        </span>
        <Button
          onClick={() => { setEditingConnection({}); setIsModalOpen(true); }}
          size="sm"
          className="h-7 gap-1.5 text-xs rounded-md px-3"
        >
          <Plus className="w-3 h-3" />
          {t('connection.new')}
        </Button>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border/40 flex items-center justify-center mb-5">
              <Globe className="w-7 h-7 text-muted-foreground/25" />
            </div>
            <h3 className="text-sm font-semibold mb-1.5">没有已保存的连接</h3>
            <p className="text-xs text-muted-foreground/60 max-w-sm mb-5 leading-relaxed">
              添加你的第一个 SSH 服务器，开始远程管理。
            </p>
            <Button
              onClick={() => { setEditingConnection({}); setIsModalOpen(true); }}
              size="sm"
              className="gap-1.5 text-xs h-8 px-5 rounded-md"
            >
              <Plus className="w-3.5 h-3.5" />
              添加服务器
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Search className="w-8 h-8 text-muted-foreground/20 mb-3" />
            <p className="text-xs text-muted-foreground/50">没有匹配 "{filterQuery}" 的连接</p>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filtered.map(c => (
                <div
                  key={c.id}
                  onClick={() => onConnect(c)}
                  className="group relative rounded-lg border border-border/30 bg-card/40 cursor-pointer transition-all duration-200 hover:border-primary/25 hover:bg-card/70 hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 overflow-hidden"
                >
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                  <div className="relative p-4">
                    {/* Header: icon + actions */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center">
                        <Server className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-150">
                        <button
                          onClick={(e) => editConnection(c, e)}
                          className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => deleteConnection(c.id, e)}
                          className="h-6 w-6 rounded-md flex items-center justify-center text-destructive/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Info */}
                    <h3 className="text-[13px] font-semibold truncate mb-1" title={c.name}>{c.name}</h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                      <span className="font-mono truncate">{c.username}@{c.host}</span>
                      {c.port !== 22 && (
                        <span className="text-[9px] px-1 py-px rounded bg-muted/50 border border-border/40 font-mono">:{c.port}</span>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-3 pt-2.5 border-t border-border/20 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
                        <Zap className="w-2.5 h-2.5" />
                        <span>快速连接</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200" />
                    </div>
                  </div>
                </div>
              ))}


            </div>
          </div>
        )}
      </div>

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
