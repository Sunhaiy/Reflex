import { Minus, Square, X, Settings, Terminal, Bot, Home, Plus } from "lucide-react";
import { cn } from '../lib/utils';
import { SSHConnection } from '../shared/types';

export type WorkspaceMode = 'normal' | 'agent';

interface SessionInfo {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connected' | 'disconnected';
}

interface TitleBarProps {
  onSettings?: () => void;
  onHome?: () => void;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  showModeSwitch?: boolean;
  showHome?: boolean;
  // Session tab props (integrated)
  sessions?: SessionInfo[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onCloseSession?: (id: string, e: React.MouseEvent) => void;
  onNewSession?: () => void;
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
      className="h-9 bg-background/80 border-b border-border/50 flex items-center select-none shrink-0"
      style={{ WebkitAppRegion: "drag" } as any}
    >
      {/* Left: Branding + Home */}
      <div
        className="flex items-center gap-1 px-3 shrink-0 h-full"
        style={{ WebkitAppRegion: "no-drag" } as any}
      >
        <div
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-default pr-1"
          style={{ WebkitAppRegion: "drag" } as any}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-primary/30"></div>
          藏青
        </div>

        {showHome && (
          <button
            onClick={onHome}
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            title="连接管理"
          >
            <Home className="w-3 h-3" />
          </button>
        )}

        {/* Mode Switch — compact pills */}
        {showModeSwitch && (
          <div className="flex items-center bg-secondary/50 rounded-full p-0.5 border border-border/40 ml-1">
            <button
              onClick={() => onModeChange?.('normal')}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-200",
                mode === 'normal'
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Terminal className="w-3 h-3" />
              终端
            </button>
            <button
              onClick={() => onModeChange?.('agent')}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-200",
                mode === 'agent'
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Bot className="w-3 h-3" />
              Agent
            </button>
          </div>
        )}
      </div>

      {/* Center: Session Tabs */}
      {hasSessions && (
        <div
          className="flex-1 flex items-center overflow-x-auto no-scrollbar h-full gap-0.5 px-1"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          {sessions.map((session) => (
            <div
              key={session.uniqueId}
              onClick={() => onSwitchSession?.(session.uniqueId)}
              className={cn(
                "group relative flex items-center h-6 px-2.5 min-w-[100px] max-w-[160px] rounded-md cursor-pointer transition-all duration-150 text-[11px]",
                activeSessionId === session.uniqueId
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                session.status === 'disconnected' && "opacity-50"
              )}
            >
              <div className={cn(
                "w-1.5 h-1.5 rounded-full mr-1.5 shrink-0",
                session.status === 'connected' ? "bg-emerald-500" : "bg-red-400/80"
              )} />
              <span className="truncate flex-1" title={session.connection.name}>
                {session.connection.name}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseSession?.(session.uniqueId, e); }}
                className={cn(
                  "ml-1 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-all",
                  activeSessionId === session.uniqueId && "opacity-50"
                )}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          {/* New tab button */}
          <button
            onClick={onNewSession}
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
            title="新建连接"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Spacer when no sessions */}
      {!hasSessions && <div className="flex-1" style={{ WebkitAppRegion: "drag" } as any} />}

      {/* Right: Settings + Window Controls */}
      <div className="flex items-center h-full shrink-0" style={{ WebkitAppRegion: "no-drag" } as any}>
        <button
          onClick={onSettings}
          className="h-full w-9 flex items-center justify-center hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
          title="设置"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-3.5 bg-border/50 mx-0.5"></div>
        <button
          onClick={() => (window as any).electron.minimize()}
          className="h-full w-9 flex items-center justify-center hover:bg-accent/60 text-muted-foreground transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => (window as any).electron.maximize()}
          className="h-full w-9 flex items-center justify-center hover:bg-accent/60 text-muted-foreground transition-colors"
        >
          <Square className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={() => (window as any).electron.close()}
          className="h-full w-9 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
