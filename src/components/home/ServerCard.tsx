import { HugeiconsIcon } from '@hugeicons/react';
import {
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
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { latencyClass, type Probe } from '../../hooks/useHostProbes';
import { normalizeProviderUrl, providerUrlLabel } from '../../shared/providerUrl';
import type { SSHConnection } from '../../shared/types';

type SessionStatus = 'connecting' | 'connected' | 'disconnected';

interface ServerCardProps {
  connection: SSHConnection;
  status?: SessionStatus;
  /** Present once the session exists, which is what turns Connect into Open. */
  hasSession: boolean;
  probe?: Probe;
  lastConnectedAt?: number;
  deleting: boolean;
  copied: boolean;
  onConnect: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function providerLinkOf(providerUrl?: string) {
  const url = normalizeProviderUrl(providerUrl);
  const label = providerUrlLabel(providerUrl);
  return url && label ? { url, label } : null;
}

function relativeTime(at: number | undefined, t: (key: string, values?: Record<string, string | number>) => string) {
  if (!at) return null;
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return t('home.lastJustNow');
  if (minutes < 60) return t('home.lastMinutes', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('home.lastHours', { hours });
  return t('home.lastDays', { days: Math.floor(hours / 24) });
}

function statusMeta(status: SessionStatus | undefined, t: (key: string) => string) {
  // Connected is the ordinary, healthy state, so it wears the user's accent. Amber and
  // rose stay for the two states that are genuinely transitional or wrong.
  if (status === 'connected') return { label: t('home.statusConnected'), dot: 'bg-primary', text: 'text-primary' };
  if (status === 'connecting') return { label: t('home.statusConnecting'), dot: 'animate-pulse bg-amber-400', text: 'text-amber-500' };
  if (status === 'disconnected') return { label: t('home.statusDisconnected'), dot: 'bg-rose-400', text: 'text-rose-500' };
  return { label: t('home.statusIdle'), dot: 'bg-muted-foreground/35', text: 'text-muted-foreground' };
}

export function ServerCard({
  connection,
  status,
  hasSession,
  probe,
  lastConnectedAt,
  deleting,
  copied,
  onConnect,
  onCopy,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ServerCardProps) {
  const { t } = useTranslation();
  const statusInfo = statusMeta(status, t);
  const connected = status === 'connected';
  const providerLink = providerLinkOf(connection.providerUrl);
  const lastSeen = relativeTime(lastConnectedAt, t);

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
    <div className="relative">
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
        aria-label={hasSession ? t('home.openSession') : t('home.connect')}
        onClick={() => {
          if (!deleting) onConnect();
        }}
        onKeyDown={(event) => {
          if (deleting || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onConnect();
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
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusInfo.dot)} />
            <span className={cn('truncate font-medium', statusInfo.text)}>{statusInfo.label}</span>
          </div>

          {/* Secondary actions stay out of the way until the card is under the
              cursor or holds focus, so a screen of cards is just names. Each
              stops propagation, otherwise it would also open the session. */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCopy();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
              title={copied ? t('home.copied') : t('home.copyAddress')}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                className="h-3.5 w-3.5"
              />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
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
                onRequestDelete();
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
              {lastSeen && (
                <>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                  <span>{lastSeen}</span>
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
                  onCancelDelete();
                }}
                className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onConfirmDelete();
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
}
