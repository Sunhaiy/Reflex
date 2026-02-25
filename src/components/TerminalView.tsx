import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useThemeStore } from '../store/themeStore';
import { useSettingsStore } from '../store/settingsStore';
import { TerminalContextMenu } from './TerminalContextMenu';
import { AIPopover } from './AIPopover';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  connectionId: string;
}

export function TerminalView({ connectionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { aiEnabled, rendererType } = useSettingsStore();

  // Context Menu State
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionText, setSelectionText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);

  // AI Popover State
  const [aiPopover, setAiPopover] = useState<{ x: number; y: number; text: string; type: 'explain' | 'fix' } | null>(null);

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
        // @ts-ignore
        bellStyle: settings.bellStyle,
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
        // @ts-ignore
        term.options.bellStyle = s.bellStyle;
        try { if (term.rows > 0) term.refresh(0, term.rows - 1); } catch (_) { }
        try { fitAddon.fit(); } catch (_) { }
      };
      const unsubTheme = useThemeStore.subscribe(applySettings);
      const unsubSettings = useSettingsStore.subscribe(applySettings);

      term.onData(data => {
        (window as any).electron.writeTerminal(connectionId, data);
      });

      const cleanup = (window as any).electron.onTerminalData((_: any, { id, data }: { id: string, data: string }) => {
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
            (window as any).electron.resizeTerminal(connectionId, term.cols, term.rows);
          }
        } catch (e) {
          console.warn('Resize fit failed:', e);
        }
      };

      const handleNativeContextMenu = (e: MouseEvent) => {
        if (containerRef.current?.contains(e.target as Node)) {
          e.preventDefault();
          e.stopImmediatePropagation();

          const selection = term.getSelection();
          setSelectionText(selection || '');
          setHasSelection(!!selection && selection.length > 0);
          setMenuPos({ x: e.clientX, y: e.clientY });
        }
      };
      window.addEventListener('contextmenu', handleNativeContextMenu, true);

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        unsubTheme();
        unsubSettings();
        window.removeEventListener('contextmenu', handleNativeContextMenu, true);
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

    initTerminal().then(fn => {
      if (isMounted) {
        cleanupFn = fn;
      } else {
        // If unmounted before init finished, run cleanup immediately
        fn();
      }
    });

    return () => {
      isMounted = false;
      if (cleanupFn) cleanupFn();
    };
  }, [connectionId, rendererType]);

  // Theme/settings live updates are handled by store.subscribe() inside
  // initTerminal() above, not here. This ensures `term` is always valid.

  const handleCopy = () => {
    console.log('handleCopy called, selection:', selectionText);
    if (selectionText) {
      (window as any).electron.clipboardWriteText(selectionText);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await (window as any).electron.clipboardReadText();
      if (text) {
        (window as any).electron.writeTerminal(connectionId, text);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  const handleExplain = () => {
    if (selectionText && menuPos) {
      setAiPopover({
        x: menuPos.x,
        y: menuPos.y,
        text: selectionText,
        type: 'explain'
      });
    }
  };

  const handleFix = () => {
    if (selectionText && menuPos) {
      setAiPopover({
        x: menuPos.x,
        y: menuPos.y,
        text: selectionText,
        type: 'fix'
      });
    }
  };

  return (
    <div
      className="h-full w-full relative"
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

      {menuPos && (
        <TerminalContextMenu
          x={menuPos.x}
          y={menuPos.y}
          hasSelection={hasSelection}
          aiEnabled={aiEnabled}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onExplain={handleExplain}
          onFix={handleFix}
          onClose={() => setMenuPos(null)}
        />
      )}

      {aiPopover && (
        <AIPopover
          x={aiPopover.x}
          y={aiPopover.y}
          text={aiPopover.text}
          type={aiPopover.type}
          onClose={() => setAiPopover(null)}
          onApplyFix={(cmd) => {
            (window as any).electron?.writeTerminal(connectionId, cmd);
          }}
        />
      )}
    </div>
  );
}

