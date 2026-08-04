import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

export interface CompactMenuOption {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  placement: 'up' | 'down';
}

/**
 * A one-line dropdown for the composer toolbar.
 *
 * The trigger shows only the current value, keeping all four composer controls on one
 * line at the right column's minimum width.
 *
 * Rendered through a portal because the panes clip their overflow, which would otherwise
 * cut the list off at its first row.
 */
export function CompactMenu({ value, options, onChange, tone = 'default', title, width, maxWidth, label, panel }: {
  value: string;
  /** Ignored when `panel` is given. */
  options?: CompactMenuOption[];
  onChange?: (value: string) => void;
  /** Overrides the trigger text, for a control whose value is not its own label. */
  label?: string;
  /** Rendered instead of the option list, for a control a list cannot express. */
  panel?: React.ReactNode;
  /**
   * `accent` is the theme colour, for the control the user reaches for most.
   * `alert` marks a setting whose consequences they should keep noticing.
   */
  tone?: 'default' | 'accent' | 'alert';
  title?: string;
  /** Keeps neighbouring toolbar controls still when the selected label changes. */
  width?: number;
  maxWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options?.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const bounds = triggerRef.current.getBoundingClientRect();
    // Opens upward when there is no room below, which is common near the composer.
    const below = window.innerHeight - bounds.bottom;
    setPosition({
      left: bounds.left,
      top: below > 220 ? bounds.bottom + 4 : bounds.top - 4,
      width: Math.max(bounds.width, 160),
      placement: below > 220 ? 'down' : 'up',
    });
  }, [open]);

  // The portal is measured at its real content width before paint. This matters in the
  // narrow right column, where aligning the panel to the trigger can otherwise put its
  // right half outside the window and make the high-effort stops unreachable.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !position || !menu) return;

    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, position.left), maxLeft);

    const height = menu.offsetHeight;
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const top = position.placement === 'up'
      ? window.innerHeight - Math.min(
        Math.max(VIEWPORT_MARGIN, window.innerHeight - position.top),
        maxTop,
      )
      : Math.min(Math.max(VIEWPORT_MARGIN, position.top), maxTop);

    if (Math.abs(left - position.left) > 0.5 || Math.abs(top - position.top) > 0.5) {
      setPosition((current) => current ? { ...current, left, top } : current);
    }
  }, [open, position]);

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

  const openUpward = position?.placement === 'up';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title ?? selected?.hint}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup={panel ? 'dialog' : 'menu'}
        style={width || maxWidth ? { width, maxWidth } : undefined}
        className={cn(
          'flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-medium',
          'transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97]',
          width && 'justify-between',
          tone === 'alert' && 'bg-rose-500 text-white hover:bg-rose-500/90',
          tone === 'accent' && 'bg-primary text-primary-foreground hover:bg-primary/90',
          tone === 'default' && 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]',
          open && 'shadow-sm',
        )}
      >
        {selected?.icon}
        <span
          key={label ?? selected?.label ?? value}
          className={cn(
            'truncate text-left',
            width && 'min-w-0 flex-1',
            'animate-in fade-in-0 slide-in-from-bottom-1 duration-150',
          )}
        >
          {label ?? selected?.label ?? value}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn(
            'h-3 w-3 shrink-0 opacity-60 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
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
          role={panel ? 'dialog' : 'menu'}
          aria-label={title}
          className={cn(
            'glass-panel fixed z-[9999] max-h-64 max-w-[min(340px,calc(100vw-16px))] overflow-y-auto rounded-xl p-1',
            'animate-in fade-in-0 zoom-in-95 duration-150 ease-out',
            openUpward ? 'origin-bottom slide-in-from-bottom-1' : 'origin-top slide-in-from-top-1',
          )}
        >
          {panel}
          {!panel && options?.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange?.(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                option.value === value
                  ? 'bg-foreground/[0.09] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              {option.icon ?? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  className={cn(
                    'mt-0.5 h-3 w-3 shrink-0',
                    option.value === value ? 'opacity-100' : 'opacity-0',
                  )}
                />
              )}
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
