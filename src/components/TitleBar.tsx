import { Minus, Square, X, Settings, Terminal, Bot } from "lucide-react";
import { cn } from '../lib/utils';

export type WorkspaceMode = 'normal' | 'agent';

interface TitleBarProps {
  onSettings?: () => void;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  showModeSwitch?: boolean;
}

export function TitleBar({ onSettings, mode = 'normal', onModeChange, showModeSwitch = false }: TitleBarProps) {
  return (
    <div className="h-8 bg-background border-b flex items-center justify-between select-none" style={{ WebkitAppRegion: "drag" } as any}>
      <div className="px-4 text-xs font-medium text-muted-foreground flex items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as any}>
        <div className="flex items-center gap-2 cursor-default" style={{ WebkitAppRegion: "drag" } as any}>
          <div className="w-3 h-3 rounded-full bg-primary/20"></div>
          藏青
        </div>

        {/* Mode Switch */}
        {showModeSwitch && (
          <div className="flex items-center bg-secondary/60 rounded-full p-0.5 border border-border/50">
            <button
              onClick={() => onModeChange?.('normal')}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-200",
                mode === 'normal'
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="普通模式"
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
              title="Agent 模式"
            >
              <Bot className="w-3 h-3" />
              Agent
            </button>
          </div>
        )}
      </div>
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as any}>
        <button
          onClick={onSettings}
          className="h-full w-10 flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <div className="w-px h-4 my-auto bg-border mx-1"></div>
        <button
          onClick={() => (window as any).electron.minimize()}
          className="h-full w-10 flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => (window as any).electron.maximize()}
          className="h-full w-10 flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => (window as any).electron.close()}
          className="h-full w-10 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
