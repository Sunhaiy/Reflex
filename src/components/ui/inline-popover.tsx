import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

/** Uses the same glass surface, anchored placement and 150ms easing as Select. */
export function InlinePopover({
  label,
  trigger,
  children,
  className,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [above, setAbove] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMounted(false);
      if (restoreFocus) triggerRef.current?.focus();
    }, 150);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!mounted) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panelRef.current?.getBoundingClientRect().height ?? 300;
      const up =
        window.innerHeight - rect.bottom < height + 20 &&
        rect.top > window.innerHeight - rect.bottom;
      setAbove(up);
      const width = Math.min(300, window.innerWidth - 24);
      setStyle({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.max(
          120,
          (up ? rect.top : window.innerHeight - rect.bottom) - 20,
        ),
        ...(up
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
    };
    position();
    const observer = new ResizeObserver(position);
    if (panelRef.current) observer.observe(panelRef.current);
    const frame = requestAnimationFrame(() => {
      setOpen(true);
      panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [mounted, generation]);
  useEffect(() => {
    if (!mounted || !open) return;
    const outside = (event: PointerEvent) => {
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      )
        close(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((node) => node.getClientRects().length);
        if (!nodes.length) {
          event.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [mounted, open, close]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={mounted && open}
        onClick={() => {
          if (mounted && open) close();
          else {
            clearTimeout(timer.current);
            setGeneration((value) => value + 1);
            if (mounted) setOpen(true);
            else setMounted(true);
          }
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 active:scale-[0.97]",
          open && "bg-accent text-foreground",
          className,
        )}
      >
        {trigger}
      </button>
      {mounted &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={style}
            className={cn(
              "glass-panel fixed z-[100] overflow-y-auto rounded-2xl border-border/80 bg-popover/95 p-2 backdrop-blur-2xl transition-[opacity,transform] duration-150 ease-out",
              above ? "origin-bottom" : "origin-top",
              open
                ? "translate-y-0 scale-100 opacity-100"
                : above
                  ? "translate-y-1 scale-95 opacity-0 pointer-events-none"
                  : "-translate-y-1 scale-95 opacity-0 pointer-events-none",
            )}
          >
            <div key={generation}>{children(close)}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
