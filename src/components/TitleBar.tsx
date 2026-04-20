import { Bot, Minus, Square, X, Settings, Terminal, Home, Plus } from "lucide-react";
import { cn } from '../lib/utils';
import { SSHConnection } from '../shared/types';
import logoUrl from '../assets/logo.png';

export type WorkspaceMode = 'normal' | 'agent';

interface SessionInfo {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
}

interface TitleBarProps {
  onSettings?: () => void;
  onHome?: () => void;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  showModeSwitch?: boolean;
  showHome?: boolean;
  sessions?: SessionInfo[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onCloseSession?: (id: string, e: React.MouseEvent) => void;
  onNewSession?: () => void;
}

function getStatusMeta(status: SessionInfo['status']) {
  if (status === 'connected') {
    return {
      label: '在线',
      dot: 'bg-emerald-400',
    };
  }

  if (status === 'connecting') {
    return {
      label: '连接中',
      dot: 'bg-amber-400 animate-pulse',
    };
  }

  return {
    label: '离线',
    dot: 'bg-rose-400',
  };
}

export function TitleBar({
  onSettings,
  onHome,
  mode = 'normal',
  onModeChange,
  showModeSwitch = false,
  showHome = false,
  sessions = [],
  activeSessionId,
  onSwitchSession,
  onCloseSession,
  onNewSession,
}: TitleBarProps) {
  const hasSessions = sessions.length > 0;

  return (
    <div
      className="h-10 shrink-0 select-none border-b border-border bg-background/95"
      style={{ WebkitAppRegion: "drag" } as any}
    >
      <div className="flex h-full items-center">
        <div
          className="flex h-full shrink-0 items-center gap-2 border-r border-border px-2.5"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <button
            onClick={showHome ? onHome : undefined}
            className={cn(
              "flex h-7 items-center gap-2 rounded-lg border border-border bg-card px-2 text-foreground transition-colors",
              showHome ? "hover:bg-accent" : "cursor-default"
            )}
            title="Reflex"
          >
            <img src={logoUrl} alt="Reflex" className="h-[18px] w-[18px] rounded-md object-cover" />
            <span className="text-xs font-semibold tracking-wide">Reflex</span>
          </button>

          {showHome && (
            <button
              onClick={onHome}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="连接管理"
            >
              <Home className="h-3.5 w-3.5" />
            </button>
          )}

          {showModeSwitch && (
            <div className="flex h-7 items-center rounded-lg border border-border bg-card p-0.5">
              <button
                onClick={() => onModeChange?.('normal')}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                  mode === 'normal'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Terminal className="h-3.5 w-3.5" />
                终端
              </button>
              <button
                onClick={() => onModeChange?.('agent')}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                  mode === 'agent'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Bot className="h-3.5 w-3.5" />
                Agent
              </button>
            </div>
          )}
        </div>

        {hasSessions && (
          <div
            className="flex h-full min-w-0 shrink items-center gap-1 overflow-x-auto px-2 no-scrollbar"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            {sessions.map((session) => {
              const status = getStatusMeta(session.status);
              const active = activeSessionId === session.uniqueId;

              return (
                <div
                  key={session.uniqueId}
                  onClick={() => onSwitchSession?.(session.uniqueId)}
                  className={cn(
                    "group relative flex h-7 min-w-[122px] max-w-[190px] cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors",
                    active
                      ? "border-primary/35 bg-primary/10 text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
                    session.status === 'disconnected' && "opacity-70"
                  )}
                  title={`${session.connection.name} · ${status.label}`}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} />
                  <span className="truncate font-medium">{session.connection.name}</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseSession?.(session.uniqueId, event);
                    }}
                    className={cn(
                      "ml-auto rounded-md p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100",
                      active && "opacity-60"
                    )}
                    title="关闭连接"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            <button
              onClick={onNewSession}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              title="新建连接"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="h-full flex-1" style={{ WebkitAppRegion: "drag" } as any} />

        <div className="flex h-full shrink-0 items-center" style={{ WebkitAppRegion: "no-drag" } as any}>
          <button
            onClick={onSettings}
            className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="设置"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <button
            onClick={() => (window as any).electron.minimize()}
            className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => (window as any).electron.maximize()}
            className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          >
            <Square className="h-2.5 w-2.5" />
          </button>
          <button
            onClick={() => (window as any).electron.close()}
            className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
