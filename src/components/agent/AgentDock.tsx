import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import { AgentPanel } from './AgentPanel';

/** The terminal never shrinks below this, however far the divider is dragged. */
const MIN_TERMINAL = 140;
const MIN_PANEL = 160;
/**
 * Remembered for the app's lifetime rather than persisted: opening the agent on a second
 * tab should match the first, but the height is not worth a settings key.
 */
let rememberedHeight = 300;

export function AgentDock({ sessionId, serverLabel, children }: {
  sessionId: string;
  serverLabel: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [height, setHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const open = height > 0;

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!dragging.current || !container) return;
      const bounds = container.getBoundingClientRect();
      const next = bounds.bottom - event.clientY;
      const clamped = Math.max(MIN_PANEL, Math.min(next, bounds.height - MIN_TERMINAL));
      rememberedHeight = clamped;
      setHeight(clamped);
    };

    const release = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // The terminal has to re-measure; this is the same signal the column splitter sends.
      window.dispatchEvent(new Event('resize'));
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', release);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', release);
    };
  }, []);

  const toggle = () => {
    setHeight(open ? 0 : rememberedHeight);
    // After the pane resizes, not during: xterm measures whatever is on screen now.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

      {open && (
        <div
          onMouseDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
          }}
          className="group relative z-20 h-2 shrink-0 cursor-row-resize"
        >
          <div className="absolute inset-x-3 top-[3px] h-0.5 rounded-full transition-colors group-hover:bg-primary/35" />
        </div>
      )}

      <div
        className={cn(
          'flex shrink-0 flex-col overflow-hidden border-t border-border/50 bg-background/25',
          !open && 'border-t-transparent',
        )}
        style={{ height: open ? height : undefined }}
      >
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors',
            open
              ? 'border-b border-border/45 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <HugeiconsIcon icon={SparklesIcon} className="h-3.5 w-3.5" />
          <span>{t('agent.title')}</span>
          <HugeiconsIcon
            icon={open ? ArrowDown01Icon : ArrowUp01Icon}
            className="h-3 w-3 text-muted-foreground/70"
          />
        </button>

        {/* Mounted only while open: the panel subscribes to the event stream, and a
            closed dock on every tab would keep as many listeners as there are sessions. */}
        {open && (
          <div className="min-h-0 flex-1">
            <AgentPanel sessionId={sessionId} serverLabel={serverLabel} />
          </div>
        )}
      </div>
    </div>
  );
}
