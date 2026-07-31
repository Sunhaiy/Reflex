import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  Globe02Icon,
  Key02Icon,
  PencilIcon,
  ServerStack01Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';
import { normalizeProviderUrl, providerUrlLabel } from '../shared/providerUrl';
import type { SSHConnection } from '../shared/types';

interface HomeSession {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
  connectedAt?: number;
}

interface ServerHomeProps {
  connections: SSHConnection[];
  sessions: HomeSession[];
  onConnect: (connection: SSHConnection) => void;
  onNew: () => void;
  onEdit: (connection: SSHConnection) => void;
  onDelete: (connection: SSHConnection) => void;
}

function providerLinkOf(providerUrl?: string) {
  const url = normalizeProviderUrl(providerUrl);
  const label = providerUrlLabel(providerUrl);
  return url && label ? { url, label } : null;
}

function statusMeta(status: HomeSession['status'] | undefined, t: (key: string) => string) {
  if (status === 'connected') return { label: t('home.statusConnected'), dot: 'bg-emerald-400', text: 'text-emerald-500' };
  if (status === 'connecting') return { label: t('home.statusConnecting'), dot: 'animate-pulse bg-amber-400', text: 'text-amber-500' };
  if (status === 'disconnected') return { label: t('home.statusDisconnected'), dot: 'bg-rose-400', text: 'text-rose-500' };
  return { label: t('home.statusIdle'), dot: 'bg-muted-foreground/35', text: 'text-muted-foreground' };
}

export function ServerHome({ connections, sessions, onConnect, onNew, onEdit, onDelete }: ServerHomeProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { t } = useTranslation();

  return (
    <main className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={onNew}
            className="glass-panel surface-hover flex min-h-[220px] flex-col items-center justify-center rounded-[calc(26px*var(--radius-scale))] border-dashed p-5 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/60 bg-background">
              <HugeiconsIcon icon={Add01Icon} className="h-5 w-5" />
            </span>
            <span className="mt-4 text-sm font-semibold">{t('home.newConnection')}</span>
            <span className="mt-1.5 text-xs text-muted-foreground">{t('home.newConnectionHint')}</span>
          </button>

          {connections.map((connection) => {
            const session = sessions.find((item) => item.connection.id === connection.id);
            const status = statusMeta(session?.status, t);
            const deleting = pendingDeleteId === connection.id;
            const providerLink = providerLinkOf(connection.providerUrl);

            return (
              <article key={connection.id} className="glass-panel surface-hover group min-h-[220px] overflow-hidden rounded-[calc(26px*var(--radius-scale))] p-5">
                <div className="flex h-full flex-col">
                  <div className="flex items-start gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background">
                      <HugeiconsIcon icon={ServerStack01Icon} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[15px] font-semibold tracking-tight">{connection.name}</h3>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', status.dot)} />
                      </div>
                      <div className={cn('mt-1 text-[11px] font-medium', status.text)}>{status.label}</div>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-border/50 bg-background px-3.5 py-3">
                    <div className="truncate font-mono text-xs text-foreground/85">
                      {connection.username || 'root'}@{connection.host}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{t('home.port')} {connection.port || 22}</span>
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                      <HugeiconsIcon icon={Key02Icon} className="h-3 w-3" />
                      <span>{connection.authType === 'privateKey' ? t('home.authKey') : t('home.authPassword')}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1.5">
                    {providerLink && (
                      <button
                        type="button"
                        onClick={() => void window.electron.openExternal(providerLink.url)}
                        className="flex max-w-full items-center gap-1.5 rounded-full border border-border/55 bg-background px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                        title={providerLink.url}
                      >
                        <HugeiconsIcon icon={Globe02Icon} className="h-3 w-3 shrink-0" />
                        <span className="truncate">{providerLink.label}</span>
                        <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-2.5 w-2.5 shrink-0" />
                      </button>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border/45 pt-4">
                    {deleting ? (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{t('home.confirmDelete')}</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06]"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteId(null);
                              onDelete(connection);
                            }}
                            className="h-8 rounded-xl bg-rose-500/12 px-3 text-xs font-medium text-rose-500 hover:bg-rose-500/18"
                          >
                            {t('home.delete')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEdit(connection)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                            title={t('home.edit')}
                          >
                            <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(connection.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                            title={t('home.delete')}
                          >
                            <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => onConnect(connection)}
                          className="flex h-9 items-center gap-2 rounded-xl bg-foreground px-3.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                        >
                          {session ? t('home.openSession') : t('home.connect')}
                          <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
