import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/utils';
import { loadAllFonts } from '../../lib/fontLoader';
import type { FontCategory, FontOption } from '../../shared/fontStacks';

const categoryLabels: Record<FontCategory, string> = {
  sans: 'Sans',
  mono: 'Mono',
  serif: 'Serif',
};

export function FontPicker({ value, options, onChange }: {
  value: string;
  options: FontOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [openAbove, setOpenAbove] = useState(false);
  const selected = options.find((font) => font.value === value) ?? options[0];
  const groups = useMemo(() => ['sans', 'mono', 'serif']
    .map((category) => ({
      category: category as FontCategory,
      fonts: options.filter((font) => font.category === category),
    }))
    .filter((group) => group.fonts.length > 0), [options]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportGap = 12;
    const menuGap = 8;
    const availableBelow = window.innerHeight - rect.bottom - viewportGap - menuGap;
    const availableAbove = rect.top - viewportGap - menuGap;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const maxHeight = Math.max(180, Math.min(340, openAbove ? availableAbove : availableBelow));
    const width = Math.min(rect.width, window.innerWidth - viewportGap * 2);
    const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap);

    setOpenAbove(openAbove);
    setMenuStyle(openAbove
      ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + menuGap }
      : { left, width, maxHeight, top: rect.bottom + menuGap });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => {
          const next = !current;
          if (next) loadAllFonts();
          return next;
        })}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background/55 px-3 text-left transition-colors',
          'hover:border-foreground/20 hover:bg-background/75 focus-visible:outline-none focus-visible:border-foreground/35',
          open && 'border-foreground/30',
        )}
      >
        <span className="truncate text-sm font-medium" style={{ fontFamily: selected.value }}>{selected.label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={cn(
            'glass-panel fixed z-[100] overflow-y-auto rounded-xl border-border/80 bg-popover/95 p-1.5 backdrop-blur-xl',
            'animate-in fade-in-0 zoom-in-95 duration-150 ease-out',
            openAbove ? 'origin-bottom slide-in-from-bottom-2' : 'origin-top slide-in-from-top-2',
          )}
          style={menuStyle}
        >
          {groups.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {categoryLabels[group.category]}
              </div>
              <div className="space-y-0.5">
                {group.fonts.map((font) => {
                  const active = font.value === value;
                  return (
                    <button
                      key={font.label}
                      type="button"
                      onClick={() => {
                        onChange(font.value);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                        active ? 'bg-primary/12 text-primary' : 'hover:bg-foreground/[0.055]',
                      )}
                    >
                      <span className="flex-1 text-[15px] font-medium" style={{ fontFamily: font.value }}>{font.label}</span>
                      {active && <HugeiconsIcon icon={Tick01Icon} className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      , document.body)}
    </div>
  );
}
