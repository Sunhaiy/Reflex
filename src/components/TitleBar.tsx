import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Cancel01Icon, Home01Icon, MinusSignIcon, Settings01Icon, SquareIcon } from '@hugeicons/core-free-icons';
import { cn } from '../lib/utils';
import type { SSHConnection } from '../shared/types';

const logoUrl = `${import.meta.env.BASE_URL}tray-icon.png`;

interface SessionTab {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
}

interface TitleBarProps {
  page: 'connections' | 'workspace' | 'settings';
  sessions: SessionTab[];
  activeSessionId: string | null;
  onHome: () => void;
  onSwitchSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onNewSession: () => void;
  onSettings: () => void;
}

function statusClass(status: SessionTab['status']) {
  if (status === 'connected') return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]';
  if (status === 'connecting') return 'animate-pulse bg-amber-400';
  return 'bg-rose-400';
}

const tabClass = 'group relative flex h-9 min-w-0 items-center gap-2 rounded-xl border px-3 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25';
const windowButtonClass = 'flex h-8 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-foreground/[0.065] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25';

export function TitleBar({
  page,
  sessions,
  activeSessionId,
  onHome,
  onSwitchSession,
  onCloseSession,
  onNewSession,
  onSettings,
}: TitleBarProps) {
  return (
    <header
      className="relative z-30 flex h-12 shrink-0 select-none items-center border-b border-border/45 bg-background/48 px-2 backdrop-blur-2xl"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex w-[116px] shrink-0 items-center gap-2.5 px-2">
        <img src={logoUrl} alt="Reflex" className="h-7 w-7 rounded-xl border border-border/55 object-cover shadow-sm" />
        <span className="text-[13px] font-semibold tracking-[-0.02em]">Reflex</span>
      </div>

      <div
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onHome}
          className={cn(
            tabClass,
            'w-[128px] shrink-0',
            page === 'connections'
              ? 'border-border/65 bg-card/72 text-foreground shadow-sm backdrop-blur-xl'
              : 'border-transparent text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
          )}
        >
          <HugeiconsIcon icon={Home01Icon} className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">主界面</span>
        </button>

        {sessions.map((session) => {
          const active = page === 'workspace' && session.uniqueId === activeSessionId;
          return (
            <div
              key={session.uniqueId}
              role="button"
              tabIndex={0}
              onClick={() => onSwitchSession(session.uniqueId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSwitchSession(session.uniqueId);
                }
              }}
              className={cn(
                tabClass,
                'w-[174px] shrink-0 cursor-default',
                active
                  ? 'border-border/65 bg-card/72 text-foreground shadow-sm backdrop-blur-xl'
                  : 'border-transparent text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
              )}
              title={`${session.connection.name} · ${session.connection.username}@${session.connection.host}`}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', statusClass(session.status))} />
              <span className="min-w-0 flex-1 truncate text-left font-medium">{session.connection.name}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseSession(session.uniqueId);
                }}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-all hover:bg-foreground/10 hover:text-foreground',
                  !active && 'opacity-0 group-hover:opacity-100',
                )}
                title="关闭会话"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onNewSession}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-all hover:border-border/55 hover:bg-card/55 hover:text-foreground"
          title="新建连接"
        >
          <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pl-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          onClick={onSettings}
          className={cn(windowButtonClass, page === 'settings' && 'bg-foreground/[0.075] text-foreground')}
          title="设置"
        >
          <HugeiconsIcon icon={Settings01Icon} className="h-4 w-4" />
        </button>
        <div className="mx-1.5 h-4 w-px bg-border/55" />
        <button type="button" onClick={() => window.electron.minimize()} className={windowButtonClass} aria-label="最小化">
          <HugeiconsIcon icon={MinusSignIcon} className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => window.electron.maximize()} className={windowButtonClass} aria-label="最大化">
          <HugeiconsIcon icon={SquareIcon} className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => window.electron.close()} className={cn(windowButtonClass, 'hover:bg-rose-500/15 hover:text-rose-400')} aria-label="关闭">
          <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
