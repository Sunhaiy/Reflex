import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Copy01Icon,
  Delete02Icon,
  FlashIcon,
  Globe02Icon,
  Key02Icon,
  PencilIcon,
  ServerStack01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { HomeOverview } from './HomeOverview';
import { Input } from './ui/input';
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
  /** Epoch ms of the last successful connect, keyed by connection id. */
  lastConnectedAt: Record<string, number>;
  onNew: () => void;
  onEdit: (connection: SSHConnection) => void;
  onDelete: (connection: SSHConnection) => void;
}

function providerLinkOf(providerUrl?: string) {
  const url = normalizeProviderUrl(providerUrl);
  const label = providerUrlLabel(providerUrl);
  return url && label ? { url, label } : null;
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

interface Probe {
  /** Round trip to the SSH port in ms, or null when it could not be reached. */
  ms: number | null;
}

/** Accent under 80ms, amber to 200ms, rose beyond — and rose again for unreachable. */
function latencyClass(probe: Probe) {
  if (probe.ms === null) return 'text-rose-500';
  if (probe.ms < 80) return 'text-primary';
  if (probe.ms < 200) return 'text-amber-500';
  return 'text-rose-400';
}

/** Coarse buckets — an exact timestamp is noise next to a server's name. */
function relativeTime(at: number | undefined, t: (key: string, values?: Record<string, string | number>) => string) {
  if (!at) return null;
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return t('home.lastJustNow');
  if (minutes < 60) return t('home.lastMinutes', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('home.lastHours', { hours });
  return t('home.lastDays', { days: Math.floor(hours / 24) });
}

function statusMeta(status: HomeSession['status'] | undefined, t: (key: string) => string) {
  // Connected is the ordinary, healthy state, so it wears the user's accent. Amber and
  // rose stay for the two states that are genuinely transitional or wrong.
  if (status === 'connected') return { label: t('home.statusConnected'), dot: 'bg-primary', text: 'text-primary' };
  if (status === 'connecting') return { label: t('home.statusConnecting'), dot: 'animate-pulse bg-amber-400', text: 'text-amber-500' };
  if (status === 'disconnected') return { label: t('home.statusDisconnected'), dot: 'bg-rose-400', text: 'text-rose-500' };
  return { label: t('home.statusIdle'), dot: 'bg-muted-foreground/35', text: 'text-muted-foreground' };
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

  const [probes, setProbes] = useState<Record<string, Probe>>({});
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

  // Probed in small batches rather than all at once, and only once a minute: each probe
  // briefly occupies one of the server's unauthenticated connection slots, so there is
  // no reason to be eager about it.
  useEffect(() => {
    if (connections.length === 0) return;
    let cancelled = false;

    const sweep = async () => {
      const targets = [...connections];
      while (targets.length > 0 && !cancelled) {
        const batch = targets.splice(0, 5);
        const results = await Promise.all(batch.map(async (connection) => {
          const result = await window.electron
            .probeHost({ host: connection.host, port: connection.port || 22 })
            .catch(() => ({ ok: false as const }));
          return [connection.id, { ms: result.ok ? result.ms ?? null : null }] as const;
        }));
        if (cancelled) return;
        setProbes((current) => ({ ...current, ...Object.fromEntries(results) }));
      }
    };

    void sweep();
    const timer = setInterval(() => void sweep(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connections]);

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
            const status = statusMeta(session?.status, t);
            const deleting = pendingDeleteId === connection.id;
            const connected = session?.status === 'connected';
            const probe = probes[connection.id];
            const providerLink = providerLinkOf(connection.providerUrl);

            return (
              // Adapted from the 21st.dev profile card: a coloured slab sits behind the
              // card and peeks out above it, carrying the address. The card itself is a
              // frosted radial gradient rather than a flat fill. Both are driven by theme
              // variables instead of the original's hardcoded #1a1a1a and lime, so the
              // light appearance and the user's accent colour both work.
              //
              // No entrance animation on this wrapper on purpose: an animating opacity or
              // transform on an ancestor makes the card its own backdrop root, so the
              // frosted backdrop-filter below has nothing to sample until the animation
              // finishes and the blur always arrives a beat late.
              <div key={connection.id} className="relative">
                {/* The accent slab is the reward for being connected. Idle servers get a
                    plain recessed one, so a screen of them reads as monochrome and the
                    live server is the only thing glowing. */}
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-3 -top-8 bottom-[72%] rounded-[calc(26px*var(--radius-scale))]',
                    'transition-colors duration-300',
                    connected ? 'bg-primary' : 'bg-background/85',
                  )}
                  style={{
                    // Idle keeps its inset top edge only — a 1px highlight, not a drop
                    // shadow. Without it the strip and the card sat at the same value
                    // and the whole thing read as one flat plane.
                    boxShadow: connected
                      ? '0 -26px 56px -20px hsl(var(--primary) / 0.7)'
                      : 'inset 0 1px 0 hsl(var(--foreground) / 0.07)',
                  }}
                />

                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 -top-8 flex h-8 items-center justify-center gap-1.5 px-7',
                    'text-[11px] font-medium transition-colors duration-300',
                    connected ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  <HugeiconsIcon icon={FlashIcon} className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">
                    {connection.username || 'root'}@{connection.host}
                  </span>
                </div>

                <article
                  role="button"
                  tabIndex={0}
                  aria-label={session ? t('home.openSession') : t('home.connect')}
                  onClick={() => {
                    if (!deleting) onConnect(connection);
                  }}
                  onKeyDown={(event) => {
                    if (deleting || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    onConnect(connection);
                  }}
                  className={cn(
                    'group relative z-10 overflow-hidden rounded-[calc(26px*var(--radius-scale))] border p-4',
                    'border-border/55 transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    !deleting && 'cursor-pointer hover:border-foreground/20',
                  )}
                  style={{
                    // Frosted rather than plain translucent. Without the blur the slab
                    // behind showed through as a hard green tint; blurring the backdrop
                    // turns that same light into a soft bloom instead.
                    background:
                      'radial-gradient(135% 115% at 28% -10%, hsl(var(--card) / 0.97) 0%,'
                      + ' hsl(var(--card) / 0.8) 45%, hsl(var(--background) / 0.68) 100%)',
                    backdropFilter: 'blur(22px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(22px) saturate(140%)',
                    // The lit top edge is what makes a dark glass panel read as raised.
                    boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.09)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} />
                      <span className={cn('truncate font-medium', status.text)}>{status.label}</span>
                    </div>

                    {/* Secondary actions stay out of the way until the card is under the
                        cursor or holds focus, so a screen of cards is just names. Each
                        stops propagation, otherwise it would also open the session. */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyAddress(connection);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                        title={copiedId === connection.id ? t('home.copied') : t('home.copyAddress')}
                      >
                        <HugeiconsIcon
                          icon={copiedId === connection.id ? Tick02Icon : Copy01Icon}
                          className="h-3.5 w-3.5"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(connection);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                        title={t('home.edit')}
                      >
                        <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDeleteId(connection.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                        title={t('home.delete')}
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-foreground/[0.09]"
                      style={{
                        background:
                          'linear-gradient(hsl(var(--foreground) / 0.08), hsl(var(--foreground) / 0.03))',
                        boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.10)',
                      }}
                    >
                      <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold tracking-tight" title={connection.name}>
                        {connection.name}
                      </h3>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                        <span>{t('home.port')} {connection.port || 22}</span>
                        <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                        <HugeiconsIcon icon={Key02Icon} className="h-3 w-3" />
                        <span>{connection.authType === 'privateKey' ? t('home.authKey') : t('home.authPassword')}</span>
                        {relativeTime(lastConnectedAt[connection.id], t) && (
                          <>
                            <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                            <span>{relativeTime(lastConnectedAt[connection.id], t)}</span>
                          </>
                        )}
                        {probe && (
                          <>
                            <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                            <span className={cn('font-medium', latencyClass(probe))}>
                              {probe.ms === null ? t('home.unreachable') : `${probe.ms}ms`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* The only hint that the card itself is the action. */}
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                    />
                  </div>

                  {providerLink && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void window.electron.openExternal(providerLink.url);
                      }}
                      className="mt-2.5 flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                      title={providerLink.url}
                    >
                      <HugeiconsIcon icon={Globe02Icon} className="h-3 w-3 shrink-0" />
                      <span className="truncate">{providerLink.label}</span>
                      <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-2.5 w-2.5 shrink-0" />
                    </button>
                  )}

                  {deleting && (
                    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-rose-500/[0.07] px-3 py-2">
                      <span className="text-xs text-muted-foreground">{t('home.confirmDelete')}</span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDeleteId(null);
                          }}
                          className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06]"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDeleteId(null);
                            onDelete(connection);
                          }}
                          className="h-8 rounded-xl bg-rose-500/15 px-3 text-xs font-medium text-rose-500 hover:bg-rose-500/25"
                        >
                          {t('home.delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              </div>
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
