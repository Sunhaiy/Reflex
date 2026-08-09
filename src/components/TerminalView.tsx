import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useThemeStore } from '../store/themeStore';
import { useSettingsStore } from '../store/settingsStore';
import { queueUsage } from '../lib/usageTracker';
import { log } from '../lib/logger';
import { subscribeTerminalEcho } from '../lib/terminalEcho';
import { subscribeTerminalData } from '../lib/terminalData';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  connectionId: string;
  active: boolean;
}

// xterm parses theme colours itself and only understands hex and rgb()/rgba() forms —
// the keyword 'transparent' throws inside its parser and silently falls back to opaque
// black. The DOM renderer hid that because CSS overrides its background layer, but the
// WebGL renderer paints its own and turned every terminal black. Alpha-zero hex works
// in both, and `allowTransparency` keeps the alpha channel intact.
const TRANSPARENT_BACKGROUND = '#00000000';
const MAX_INACTIVE_OUTPUT_CHARS = 2 * 1024 * 1024;

export function TerminalView({ connectionId, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const activeRef = useRef(active);
  const bufferedOutputRef = useRef<string[]>([]);
  const bufferedOutputCharsRef = useRef(0);
  const refreshRef = useRef<(() => void) | null>(null);
  const rendererType = useSettingsStore((state) => state.rendererType);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    if (!term) return;
    const buffered = bufferedOutputRef.current.join('');
    bufferedOutputRef.current = [];
    bufferedOutputCharsRef.current = 0;
    if (buffered) term.write(buffered, () => refreshRef.current?.());
    else refreshRef.current?.();
  }, [active]);

  // Effect to handle initialization
  useEffect(() => {
    if (!containerRef.current || !connectionId) return;

    let cleanupFn: (() => void) | undefined;
    // Set the moment this terminal is torn down. initTerminal has an await in the
    // middle and schedules several animation frames, and every one of those can land
    // after disposal — xterm then throws reading `dimensions` off a renderer that no
    // longer exists, which killed the session's whole render tree.
    let disposed = false;

    const initTerminal = () => {
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
        if (disposed || !element || element.clientWidth < 40 || element.clientHeight < 20) return false;
        try {
          fitAddon.fit();
          return true;
        } catch (error) {
          console.warn('Fit failed:', error);
          return false;
        }
      };

      const refresh = () => {
        if (disposed || !activeRef.current) return;
        requestAnimationFrame(() => {
          if (disposed || !activeRef.current) return;
          safeFit();
          try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (error) { log.warn('[Terminal] Refresh failed', error); }
          term.focus();
        });
      };
      refreshRef.current = refresh;

      const writeOutput = (text: string) => {
        if (disposed) return;
        if (activeRef.current) {
          term.write(text);
          return;
        }
        const chunk = text.length > MAX_INACTIVE_OUTPUT_CHARS
          ? text.slice(-MAX_INACTIVE_OUTPUT_CHARS)
          : text;
        bufferedOutputRef.current.push(chunk);
        bufferedOutputCharsRef.current += chunk.length;
        while (bufferedOutputCharsRef.current > MAX_INACTIVE_OUTPUT_CHARS && bufferedOutputRef.current.length > 1) {
          bufferedOutputCharsRef.current -= bufferedOutputRef.current.shift()!.length;
        }
      };

      // Open terminal
      term.open(containerRef.current!);

      // Load WebGL if enabled
      if (rendererType === 'webgl') {
        void import('@xterm/addon-webgl')
          .then(({ WebglAddon }) => {
            if (disposed) return;
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
              webglAddon.dispose();
            });
            term.loadAddon(webglAddon);
            console.log('WebGL renderer enabled');
          })
          .catch((error) => {
            if (!disposed) console.warn('Failed to load WebGL addon:', error);
          });
      }

      safeFit();
      if (activeRef.current) term.focus();

      // --- Live theme/settings subscription (registered HERE because initTerminal
      // is async, so term doesn't exist yet when useEffect callbacks run) ---
      const applySettings = () => {
        if (disposed) return;
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
        try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (error) { log.warn('[Terminal] Refresh failed', error); }
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

      const cleanup = subscribeTerminalData(connectionId, writeOutput);

      // Force repaint when this session is switched back to (canvas goes blank on visibility toggle)
      const handleTermRefresh = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.connectionId === connectionId) {
          refresh();
        }
      };
      window.addEventListener('terminal-refresh', handleTermRefresh);

      // What the agent runs shows up here too. Display only — nothing written this way
      // is sent to the server.
      const unsubEcho = subscribeTerminalEcho(connectionId, (text) => {
        writeOutput(text);
      });

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
          if (disposed || !safeFit()) return;
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
        disposed = true;
        unsubTheme();
        unsubSettings();
        window.removeEventListener('terminal-refresh', handleTermRefresh);
        unsubEcho();
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
        try {
          cleanup();
        } catch (error) {
          log.warn('[Terminal] Data listener teardown failed', error);
        }
        if (refreshRef.current === refresh) refreshRef.current = null;
        resizeObserver.disconnect();
        try {
          if (term && !term.element?.parentElement) {
            // already detached
          } else if (term) {
            term.dispose();
          }
        } catch (error) {
          log.warn('[Terminal] Dispose failed', error);
        }
        termRef.current = null;
      };
    };

    // React StrictMode intentionally mounts and tears down every effect once in
    // development. Opening xterm during that throwaway pass leaves an internal viewport
    // callback queued after dispose(), which then reads a missing render service. Waiting
    // one frame means the throwaway pass is cancelled before xterm is ever constructed.
    let initFrame = window.requestAnimationFrame(() => {
      initFrame = 0;
      if (disposed) return;
      try {
        cleanupFn = initTerminal();
      } catch (error) {
        console.error(`[Terminal] Failed to initialize session ${connectionId}:`, error);
        try { termRef.current?.dispose(); } catch { /* partially initialized */ }
        termRef.current = null;
      }
    });

    return () => {
      disposed = true;
      if (initFrame) window.cancelAnimationFrame(initFrame);
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
        if (activeRef.current) termRef.current?.focus();
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

