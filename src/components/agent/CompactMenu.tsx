import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

export interface CompactMenuOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A one-line dropdown for the composer toolbar.
 *
 * It has to survive being 320 pixels wide when the panel is docked in the right column,
 * where a row of four buttons wraps onto two lines and stops looking like a control. A
 * trigger showing only the current value fits either width.
 *
 * Rendered through a portal because the panes clip their overflow, which would otherwise
 * cut the list off at its first row.
 */
export function CompactMenu({ value, options, onChange, tone = 'default', title, maxWidth }: {
  value: string;
  options: CompactMenuOption[];
  onChange: (value: string) => void;
  /**
   * `accent` is the theme colour, for the control the user reaches for most.
   * `alert` marks a setting whose consequences they should keep noticing.
   */
  tone?: 'default' | 'accent' | 'alert';
  title?: string;
  maxWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const bounds = triggerRef.current.getBoundingClientRect();
    // Opens upward when there is no room below, which is the common case for a panel
    // docked at the bottom of the window.
    const below = window.innerHeight - bounds.bottom;
    setPosition({
      left: bounds.left,
      top: below > 220 ? bounds.bottom + 4 : bounds.top - 4,
      width: Math.max(bounds.width, 160),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const openUpward = position !== null && window.innerHeight - position.top < 220;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title ?? selected?.hint}
        onClick={() => setOpen((current) => !current)}
        style={maxWidth ? { maxWidth } : undefined}
        className={cn(
          'flex h-7 min-w-0 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors',
          tone === 'alert' && 'bg-rose-500 text-white hover:bg-rose-500/90',
          tone === 'accent' && 'bg-primary text-primary-foreground hover:bg-primary/90',
          tone === 'default' && 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]',
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          style={{
            left: position.left,
            top: openUpward ? undefined : position.top,
            bottom: openUpward ? window.innerHeight - position.top : undefined,
            minWidth: position.width,
          }}
          className="glass-panel fixed z-[9999] max-h-64 max-w-[340px] overflow-y-auto rounded-xl p-1"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                option.value === value
                  ? 'bg-foreground/[0.09] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <HugeiconsIcon
                icon={Tick02Icon}
                className={cn(
                  'mt-0.5 h-3 w-3 shrink-0',
                  option.value === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-medium">{option.label}</span>
                {option.hint && (
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
