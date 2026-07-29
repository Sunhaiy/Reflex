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
          background: 'transparent',
        }
      });

      termRef.current = term; // Set ref immediately

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Open terminal
      term.open(containerRef.current!);

      const bellDisposable = term.onBell(() => {
        const bellStyle = useSettingsStore.getState().bellStyle;
        if (bellStyle === 'none') return;

        if (bellStyle === 'visual') {
          containerRef.current?.animate(
            [
              { filter: 'brightness(1)' },
              { filter: 'brightness(1.55)' },
              { filter: 'brightness(1)' },
            ],
            { duration: 180, easing: 'ease-out' },
          );
          return;
        }

        const audioContext = new AudioContext();
        const playBell = async () => {
          if (audioContext.state === 'suspended') await audioContext.resume();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const now = audioContext.currentTime;
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(660, now);
          gain.gain.setValueAtTime(0.035, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(now);
          oscillator.stop(now + 0.1);
          oscillator.addEventListener('ended', () => void audioContext.close(), { once: true });
        };
        void playBell().catch(() => void audioContext.close());
      });

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

      try {
        fitAddon.fit();
      } catch (e) {
        console.warn('Initial fit failed:', e);
      }
      term.focus();

      // --- Live theme/settings subscription (registered HERE because initTerminal
      // is async, so term doesn't exist yet when useEffect callbacks run) ---
      const applySettings = () => {
        const t = useThemeStore.getState().terminalTheme;
        if (t) term.options.theme = { ...t, background: 'transparent' };
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
        try { fitAddon.fit(); } catch (_) { }
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
            try { fitAddon.fit(); } catch (_) { }
            try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (_) { }
            term.focus();
          });
        }
      };
      window.addEventListener('terminal-refresh', handleTermRefresh);

      const handleResize = () => {
        if (!containerRef.current) return;
        try {
          fitAddon.fit();
          if (term.cols > 0 && term.rows > 0) {
            window.electron.resizeTerminal(connectionId, term.cols, term.rows);
          }
        } catch (e) {
          console.warn('Resize fit failed:', e);
        }
      };

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        unsubTheme();
        unsubSettings();
        bellDisposable.dispose();
        window.removeEventListener('terminal-refresh', handleTermRefresh);
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

