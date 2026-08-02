import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, ServerStack01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { HomeOverview } from './HomeOverview';
import { ServerCard } from './home/ServerCard';
import { useHostProbes } from '../hooks/useHostProbes';
import { Input } from './ui/input';
import { useTranslation } from '../hooks/useTranslation';
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
  /** Epoch ms of the last successful connect, keyed by connection id. */
  lastConnectedAt: Record<string, number>;
  onNew: () => void;
  onEdit: (connection: SSHConnection) => void;
  onDelete: (connection: SSHConnection) => void;
}

/**
 * Buckets follow how the greetings actually read in Chinese, which splits midday out on
 * its own; the other languages reuse their afternoon greeting for that slot.
 */
function greetingKey(hour: number) {
  if (hour >= 5 && hour < 11) return 'home.greetingMorning';
  if (hour >= 11 && hour < 13) return 'home.greetingNoon';
  if (hour >= 13 && hour < 18) return 'home.greetingAfternoon';
  if (hour >= 18 && hour < 23) return 'home.greetingEvening';
  return 'home.greetingNight';
}

export function ServerHome({ connections, sessions, onConnect, lastConnectedAt, onNew, onEdit, onDelete }: ServerHomeProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const { t } = useTranslation();

  // A window left open overnight would otherwise still be wishing you good morning.
  useEffect(() => {
    const timer = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const probes = useHostProbes(connections);
  const [query, setQuery] = useState('');
  const [onlyConnected, setOnlyConnected] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return connections.filter((connection) => {
      if (onlyConnected) {
        const session = sessions.find((item) => item.connection.id === connection.id);
        if (session?.status !== 'connected') return false;
      }
      if (!needle) return true;
      // Matched against everything visible on the card, so typing an address works
      // as readily as typing the name.
      return [connection.name, connection.host, connection.username, connection.providerUrl]
        .some((field) => field?.toLowerCase().includes(needle));
    });
  }, [connections, onlyConnected, query, sessions]);

  const copyAddress = async (connection: SSHConnection) => {
    try {
      await navigator.clipboard.writeText(`${connection.username || 'root'}@${connection.host}`);
      setCopiedId(connection.id);
      setTimeout(() => setCopiedId((current) => (current === connection.id ? null : current)), 1500);
    } catch {
      // Clipboard access can be refused; the address stays visible on the card either way.
    }
  };

  return (
    <main className="relative z-10 h-full overflow-hidden">
      {/* Padded past the floating button so the last row never hides underneath it. */}
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-5 pb-24 pt-7 lg:px-6">
          {/* Bottom margin clears the slab that sits above the first row of cards. */}
          <header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h1 className="text-[22px] font-semibold tracking-tight">{t(greetingKey(hour))}</h1>

            {connections.length > 0 && (
              <div className="flex items-center gap-3">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('home.searchPlaceholder')}
                  className="h-9 w-[220px] rounded-xl bg-background/55 px-3 text-xs"
                  aria-label={t('home.searchPlaceholder')}
                />

                {/* A segmented pair rather than one toggle button beside the field: two
                    buttons of the same weight read as a filter, where a lone button
                    looked like it had been stuck onto the search box. Matches the
                    auth-method control in the connection form. */}
                <div className="flex shrink-0 items-center gap-1 rounded-xl bg-foreground/[0.045] p-1">
                  {[
                    { value: false, label: t('home.filterAll') },
                    { value: true, label: t('home.filterConnected') },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setOnlyConnected(option.value)}
                      className={cn(
                        'h-7 rounded-lg px-3 text-[11px] font-medium transition-colors',
                        onlyConnected === option.value
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </header>

          {/* The extra margin is not decoration: each card's slab reaches 32px above
              it, so a plain gap here collapses to almost nothing. */}
          <div className="mb-[72px]">
            {connections.length > 0 && (
              <HomeOverview />
            )}
          </div>

          {connections.length > 0 && visible.length === 0 && (
            <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
              <p className="text-xs text-muted-foreground">{t('home.noMatches')}</p>
            </div>
          )}

          {connections.length === 0 && (
            <div className="flex min-h-[62vh] flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[calc(20px*var(--radius-scale))] border border-dashed border-border/70 bg-background/50">
                <HugeiconsIcon icon={ServerStack01Icon} className="h-6 w-6 text-muted-foreground" />
              </span>
              <h2 className="mt-5 text-[15px] font-semibold tracking-tight">{t('home.emptyTitle')}</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">{t('home.newConnectionHint')}</p>
            </div>
          )}

          <div className="grid gap-x-4 gap-y-14 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((connection) => {
            const session = sessions.find((item) => item.connection.id === connection.id);
            return (
              <ServerCard
                key={connection.id}
                connection={connection}
                status={session?.status}
                hasSession={Boolean(session)}
                probe={probes[connection.id]}
                lastConnectedAt={lastConnectedAt[connection.id]}
                deleting={pendingDeleteId === connection.id}
                copied={copiedId === connection.id}
                onConnect={() => onConnect(connection)}
                onCopy={() => void copyAddress(connection)}
                onEdit={() => onEdit(connection)}
                onRequestDelete={() => setPendingDeleteId(connection.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onConfirmDelete={() => {
                  setPendingDeleteId(null);
                  onDelete(connection);
                }}
              />
            );
          })}
          </div>
        </div>
      </div>

      {/* Floating primary action: it stays reachable while the list scrolls, and keeps
          the grid made purely of real servers. Its own backdrop blur does the separating,
          so no scrim or drop shadow is needed behind it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-6">
        <button
          type="button"
          onClick={onNew}
          className="beam-line glass-panel group pointer-events-auto flex h-12 items-center gap-2.5 rounded-full pl-3 pr-5 text-[13px] font-medium text-foreground transition-colors duration-200 hover:border-foreground/20 hover:bg-card/85"
        >
          {/* The beam renders in ::before/::after, which paint over children by default. */}
          <span className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-full bg-foreground/[0.07] transition-colors duration-200 group-hover:bg-foreground/[0.11]">
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
          </span>
          <span className="relative z-[1]">{t('home.newConnection')}</span>
        </button>
      </div>
    </main>
  );
}
