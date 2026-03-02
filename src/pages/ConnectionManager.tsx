import { useState, useEffect, useCallback } from 'react';
import { SSHConnection } from '../shared/types';
import { Button } from '../components/ui/button';
import { Trash2, Plus, Edit2, Server, Zap, Globe, ArrowRight, Search, Copy, Check } from 'lucide-react';
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const deleteConnection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete(id);  // show inline confirm instead of native dialog
  };

  const confirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = connections.filter(c => c.id !== id);
    setConnections(next);
    await (window as any).electron.storeSet('connections', next);
    setPendingDelete(null);
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
              {filtered.map((c, idx) => {
                const accentColors = ['#10b981', '#8b5cf6', '#3b82f6', '#f59e0b', '#f43f5e'];
                const accentHex = accentColors[idx % accentColors.length];

                // OS detection from name/host keywords
                const nameLower = (c.name + ' ' + (c.os || '')).toLowerCase();
                let osIcon = '🐧'; // default Linux
                let osName = 'Linux';
                if (nameLower.includes('ubuntu')) { osIcon = ''; osName = 'Ubuntu'; }
                else if (nameLower.includes('debian')) { osIcon = ''; osName = 'Debian'; }
                else if (nameLower.includes('centos') || nameLower.includes('rhel') || nameLower.includes('redhat')) { osIcon = ''; osName = 'CentOS'; }
                else if (nameLower.includes('alpine')) { osIcon = ''; osName = 'Alpine'; }
                else if (nameLower.includes('windows') || nameLower.includes('win')) { osIcon = ''; osName = 'Windows'; }

                // OS SVG icons
                const OsLogo = () => {
                  const size = 18;
                  if (osName === 'Ubuntu') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="5" r="1.8" fill="#E95420" /><circle cx="6" cy="15.5" r="1.8" fill="#E95420" /><circle cx="18" cy="15.5" r="1.8" fill="#E95420" /></svg>
                  );
                  if (osName === 'Debian') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M13 6c1.5.5 3 2 3.5 4s0 4-1.5 5.5-4 2-6 1-3-3-2.5-5.5S11 6 13 6z" stroke="#A80030" strokeWidth="1.5" fill="none" /></svg>
                  );
                  if (osName === 'CentOS') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" fill="#9CCD2A" opacity="0.7" /><rect x="13" y="3" width="8" height="8" rx="1" fill="#262577" opacity="0.7" /><rect x="3" y="13" width="8" height="8" rx="1" fill="#932279" opacity="0.7" /><rect x="13" y="13" width="8" height="8" rx="1" fill="#EFA724" opacity="0.7" /></svg>
                  );
                  if (osName === 'Alpine') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 4L3 18h18L12 4z" stroke="#0D597F" strokeWidth="1.5" fill="#0D597F" fillOpacity="0.2" /><path d="M12 9l-4 7h8l-4-7z" fill="#0D597F" fillOpacity="0.5" /></svg>
                  );
                  if (osName === 'Windows') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 12.5l7.5-1V5L3 6.5v6zm0 1l7.5 1V21L3 19.5v-6zm8.5-2l9.5-1.5V4L11.5 6v5.5zm0 3l9.5 1.5V20l-9.5-2v-5z" fill="#00A4EF" opacity="0.8" /></svg>
                  );
                  return <Server className="w-4 h-4 text-muted-foreground" />;
                };

                const copyIp = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(c.host).then(() => {
                    setCopiedId(c.id);
                    setTimeout(() => setCopiedId(prev => prev === c.id ? null : prev), 1500);
                  }).catch(() => { });
                };
                const isCopied = copiedId === c.id;

                return (
                  <div
                    key={c.id}
                    onClick={() => onConnect(c)}
                    className="group relative rounded-xl cursor-pointer transition-all duration-500 overflow-hidden border border-border/50 hover:border-border bg-card"
                  >
                    {/* Hover gradient overlay */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                      style={{ background: `linear-gradient(135deg, ${accentHex}06, transparent 60%, ${accentHex}04)` }}
                    />

                    {/* Content */}
                    <div className="relative p-3.5">

                      {/* Row 1: OS icon + Server name + status dot + actions */}
                      <div className="flex items-center gap-2.5 mb-2.5">
                        {/* OS icon */}
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-border/40 transition-all duration-300"
                          style={{
                            background: `linear-gradient(135deg, ${accentHex}15, ${accentHex}05)`,
                          }}
                        >
                          <OsLogo />
                        </div>
                        {/* Name + dot */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-[13px] font-semibold truncate leading-tight" title={c.name}>{c.name}</h3>
                            <div
                              className="w-1.5 h-1.5 rounded-full shrink-0 card-breathe"
                              style={{ color: accentHex, backgroundColor: accentHex }}
                            />
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono-code truncate mt-0.5">
                            {c.username}@{c.host}{c.port !== 22 ? `:${c.port}` : ''}
                          </div>
                        </div>
                        {/* Actions (hover) */}
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0">
                          <button
                            onClick={(e) => editConnection(c, e)}
                            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
                            title={t('common.edit')}
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                          {pendingDelete === c.id ? (
                            <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }}
                                className="h-6 px-1.5 rounded-md text-[9px] text-muted-foreground hover:bg-muted/60 transition-colors"
                              >取消</button>
                              <button
                                onClick={(e) => confirmDelete(c.id, e)}
                                className="h-6 px-1.5 rounded-md text-[9px] text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
                              >删除</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => deleteConnection(c.id, e)}
                              className="h-6 w-6 rounded-md flex items-center justify-center text-destructive/50 hover:text-destructive hover:bg-destructive/5 transition-colors"
                              title={t('common.delete')}
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Tags (always reserve space for layout consistency) */}
                      <div className="flex items-center gap-1 flex-wrap mb-2.5 min-h-[20px]">
                        {c.tags?.map(tag => (
                          <span
                            key={tag}
                            className="text-[8px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider ring-1"
                            style={{
                              color: `${accentHex}cc`,
                              background: `${accentHex}08`,
                              boxShadow: `inset 0 0 0 1px ${accentHex}20`,
                            }}
                          >{tag}</span>
                        ))}
                      </div>

                      {/* Row 3: Instrument panel — mini gauges */}
                      <div className="pt-2.5 border-t border-border/20">
                        {/* Mini bars: CPU + RAM (seeded from id for stable display) */}
                        {(() => {
                          // Simple hash from id to get stable pseudo-random values
                          let h = 0;
                          for (let i = 0; i < c.id.length; i++) h = ((h << 5) - h + c.id.charCodeAt(i)) | 0;
                          const cpuVal = 5 + Math.abs(h % 60);  // 5-64%
                          const ramVal = 20 + Math.abs((h >> 8) % 55); // 20-74%
                          const pingVal = 8 + Math.abs((h >> 16) % 180); // 8-187ms
                          return (
                            <>
                              <div className="flex items-center gap-3 mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-medium">CPU</span>
                                    <span className="text-[8px] font-mono-code text-muted-foreground/60">{cpuVal}%</span>
                                  </div>
                                  <div className="h-[3px] rounded-full bg-muted/50 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${cpuVal}%`, backgroundColor: `${accentHex}90` }} />
                                  </div>
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-medium">RAM</span>
                                    <span className="text-[8px] font-mono-code text-muted-foreground/60">{ramVal}%</span>
                                  </div>
                                  <div className="h-[3px] rounded-full bg-muted/50 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${ramVal}%`, backgroundColor: `${accentHex}60` }} />
                                  </div>
                                </div>
                                {/* Ping */}
                                <div className="shrink-0 text-right">
                                  <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-medium">PING</span>
                                  <div className="text-[9px] font-mono-code mt-0.5" style={{ color: pingVal < 50 ? '#10b981' : pingVal < 120 ? '#f59e0b' : '#ef4444' }}>
                                    {pingVal}ms
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}

                        {/* Bottom: copy IP + connect arrow */}
                        <div className="flex items-center justify-between">
                          <button
                            onClick={copyIp}
                            className={cn(
                              "flex items-center gap-1 text-[9px] transition-all duration-300",
                              isCopied ? "text-emerald-400" : "text-muted-foreground/50 hover:text-muted-foreground/80"
                            )}
                            title="Copy IP"
                          >
                            {isCopied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                            <span className="font-mono-code">{isCopied ? '已复制' : c.host}</span>
                          </button>
                          <div
                            className="w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0"
                            style={{ background: `linear-gradient(135deg, ${accentHex}cc, ${accentHex}88)` }}
                          >
                            <ArrowRight className="w-3 h-3 text-white" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}


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
