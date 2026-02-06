import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  return (
    <div className="h-8 bg-background border-b flex items-center justify-between select-none" style={{ WebkitAppRegion: "drag" } as any}>
      <div className="px-4 text-xs font-medium text-muted-foreground flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-primary/20"></div>
        藏青
      </div>
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as any}>
        <button
          onClick={() => window.electron.minimize()}
          className="h-full w-10 flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() => window.electron.maximize()}
          className="h-full w-10 flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => window.electron.close()}
          className="h-full w-10 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
