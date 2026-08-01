import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useThemeStore } from '../store/themeStore';
import { useSettingsStore } from '../store/settingsStore';
import { queueUsage } from '../lib/usageTracker';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  connectionId: string;
}

// xterm parses theme colours itself and only understands hex and rgb()/rgba() forms —
// the keyword 'transparent' throws inside its parser and silently falls back to opaque
// black. The DOM renderer hid that because CSS overrides its background layer, but the
// WebGL renderer paints its own and turned every terminal black. Alpha-zero hex works
// in both, and `allowTransparency` keeps the alpha channel intact.
const TRANSPARENT_BACKGROUND = '#00000000';

export function TerminalView({ connectionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const rendererType = useSettingsStore((state) => state.rendererType);

  // Effect to handle initialization
  useEffect(() => {
    if (!containerRef.current || !connectionId) return;

    let cleanupFn: (() => void) | undefined;

    const initTerminal = async () => {
      // Use current values from store for initialization
      const settings = useSettingsStore.getState();
      const currentTerminalTheme = useThemeStore.getState().terminalTheme;

      const term = new Terminal({
        cursorBlink: settings.cursorBlink,
        cursorStyle: settings.cursorStyle,
        fontSize: settings.fontSize,
        fontFamily: settings.terminalFontFamily,
        letterSpacing: settings.letterSpacing,
        lineHeight: settings.lineHeight,
        scrollback: settings.scrollback,
        drawBoldTextInBrightColors: settings.brightBold,
        allowProposedApi: true,
        allowTransparency: true,
        theme: {
          ...(currentTerminalTheme || {}),
          background: TRANSPARENT_BACKGROUND,
        }
      });

      termRef.current = term; // Set ref immediately

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // A hidden session, or one measured before layout, reports 0x0. Fitting to that
      // yields a one-column terminal and — worse — sends that width to the shell as a
      // window-change, which reflows the prompt into wrapped fragments that stay in the
      // scrollback for good. Every fit goes through here.
      const safeFit = () => {
        const element = containerRef.current;
        if (!element || element.clientWidth < 40 || element.clientHeight < 20) return false;
        try {
          fitAddon.fit();
          return true;
        } catch (error) {
          console.warn('Fit failed:', error);
          return false;
        }
      };

      // Open terminal
      term.open(containerRef.current!);

      // Load WebGL if enabled
      if (rendererType === 'webgl') {
        try {
          const { WebglAddon } = await import('@xterm/addon-webgl');
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
          });
          term.loadAddon(webglAddon);
          console.log('WebGL renderer enabled');
        } catch (e) {
          console.warn('Failed to load WebGL addon:', e);
        }
      }

      safeFit();
      term.focus();

      // --- Live theme/settings subscription (registered HERE because initTerminal
      // is async, so term doesn't exist yet when useEffect callbacks run) ---
      const applySettings = () => {
        const t = useThemeStore.getState().terminalTheme;
        if (t) term.options.theme = { ...t, background: TRANSPARENT_BACKGROUND };
        const s = useSettingsStore.getState();
        term.options.fontFamily = s.terminalFontFamily;
        term.options.fontSize = s.fontSize;
        term.options.lineHeight = s.lineHeight;
        term.options.letterSpacing = s.letterSpacing;
        term.options.cursorStyle = s.cursorStyle;
        term.options.cursorBlink = s.cursorBlink;
        term.options.scrollback = s.scrollback;
        term.options.drawBoldTextInBrightColors = s.brightBold;
        try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (_) { }
        safeFit();
      };
      const unsubTheme = useThemeStore.subscribe(applySettings);
      const unsubSettings = useSettingsStore.subscribe(applySettings);

      term.onData(data => {
        window.electron.writeTerminal(connectionId, data);
        const submittedCommands = (data.match(/[\r\n]/g) || []).length;
        queueUsage({
          terminalInputCharacters: data.length,
          serverOperations: submittedCommands,
          activity: Math.min(40, data.length + submittedCommands * 4),
        });
      });

      const cleanup = window.electron.onTerminalData((_, { id, data }) => {
        if (id === connectionId) {
          term.write(data);
        }
      });

      // Force repaint when this session is switched back to (canvas goes blank on visibility toggle)
      const handleTermRefresh = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.connectionId === connectionId) {
          requestAnimationFrame(() => {
            safeFit();
            try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (_) { }
            term.focus();
          });
        }
      };
      window.addEventListener('terminal-refresh', handleTermRefresh);

      // ResizeObserver fires in bursts while panels are dragged. Coalescing to one fit
      // per frame, and only sending a window-change when the grid actually changed,
      // keeps redundant SSH packets off the connection the shell is typing on.
      let resizeFrame = 0;
      let lastCols = 0;
      let lastRows = 0;

      const handleResize = () => {
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          if (!safeFit()) return;
          // A plausible terminal is at least a couple of columns wide; anything smaller
          // means the measurement was taken mid-layout and must not reach the shell.
          if (term.cols > 2 && term.rows > 1 && (term.cols !== lastCols || term.rows !== lastRows)) {
            lastCols = term.cols;
            lastRows = term.rows;
            window.electron.resizeTerminal(connectionId, term.cols, term.rows);
          }
        });
      };

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        unsubTheme();
        unsubSettings();
        window.removeEventListener('terminal-refresh', handleTermRefresh);
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
        try {
          cleanup();
        } catch (e) { }
        resizeObserver.disconnect();
        try {
          if (term && !term.element?.parentElement) {
            // already detached
          } else if (term) {
            term.dispose();
          }
        } catch (e) { }
        termRef.current = null;
      };
    };

    // We need to manage cleanup manually since initTerminal is async
    let isMounted = true;

    void initTerminal()
      .then(fn => {
        if (isMounted) {
          cleanupFn = fn;
        } else {
          // If unmounted before init finished, run cleanup immediately
          fn();
        }
      })
      .catch((error) => {
        console.error(`[Terminal] Failed to initialize session ${connectionId}:`, error);
      });

    return () => {
      isMounted = false;
      if (cleanupFn) cleanupFn();
    };
  }, [connectionId, rendererType]);

  // Theme/settings live updates are handled by store.subscribe() inside
  // initTerminal() above, not here. This ensures `term` is always valid.

  return (
    <div
      className="relative h-full w-full"
      onMouseDown={() => {
        // Ensure terminal gets focus when clicking anywhere in its container
        termRef.current?.focus();
      }}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: 'transparent' }}
      />
    </div>
  );
}

