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
  const { theme, terminalTheme } = useThemeStore();
  const {
    terminalFontFamily,
    fontSize,
    lineHeight,
    letterSpacing,
    cursorStyle,
    cursorBlink
  } = useSettingsStore();
  const {
    rendererType,
    scrollback,
    brightBold,
    bellStyle
  } = useSettingsStore();

  // Context Menu State
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionText, setSelectionText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);

  // AI Popover State
  const [aiPopover, setAiPopover] = useState<{ x: number; y: number; text: string; type: 'explain' | 'fix' } | null>(null);

  useEffect(() => {
    if (!termRef.current) return;

    // Update terminal theme when app theme changes
    termRef.current.options.theme = {
      ...theme.terminal,
      selection: theme.terminal.selectionBackground
    };
  }, [theme]);

  // Handle Theme Change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  // Dynamic settings updates
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontFamily = terminalFontFamily;
    termRef.current.options.fontSize = fontSize;
    termRef.current.options.lineHeight = lineHeight;
    termRef.current.options.letterSpacing = letterSpacing;
    termRef.current.options.cursorStyle = cursorStyle;
    termRef.current.options.cursorBlink = cursorBlink;
    termRef.current.options.scrollback = scrollback;
    termRef.current.options.drawBoldTextInBrightColors = brightBold;
    termRef.current.options.bellStyle = bellStyle as any;

    // Handle WebGL toggle dynamically?
    // It's tricky to toggle WebGL without disposing.
    // For now we just recommend reload if changing renderer,
    // or we could try to load/dispose addon here.
    // Let's stick to initial load for renderer to avoid complexity/crashes.

    // Trigger fit after font size/spacing changes
    // @ts-ignore
    try { termRef.current?._addonManager?.addons?.forEach(addon => { if (addon.constructor.name === 'FitAddon') addon.fit(); }); } catch (e) { }
  }, [terminalFontFamily, fontSize, lineHeight, letterSpacing, cursorStyle, cursorBlink, scrollback, brightBold, bellStyle]);

  useEffect(() => {
    if (!containerRef.current || !connectionId) return;

    // Import WebGL Addon dynamically only if needed?
    // We already removed the static import to fix crash.
    // If we want to support it, we need to dynamically import it or have it available.
    // To support WebGL safely, we should lazy import it inside the effect.

    const initTerminal = async () => {
      // Use current values from store for initialization
      const settings = useSettingsStore.getState();
      const currentTerminalTheme = useThemeStore.getState().theme.terminal; // Get latest terminal theme

      const term = new Terminal({
        cursorBlink: settings.cursorBlink,
        cursorStyle: settings.cursorStyle,
        fontSize: settings.fontSize,
        fontFamily: settings.terminalFontFamily,
        letterSpacing: settings.letterSpacing,
        lineHeight: settings.lineHeight,
        scrollback: settings.scrollback,
        drawBoldTextInBrightColors: settings.brightBold,
        bellStyle: settings.bellStyle,
        allowProposedApi: true,
        theme: {
          ...currentTerminalTheme,
          // selectionBackground is already in theme.terminal
        }
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Open terminal first
      term.open(containerRef.current!);

      // Load WebGL if enabled
      if (rendererType === 'webgl') {
        try {
          // Dynamic import to avoid crash if not available/supported
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
      termRef.current = term;

      term.onData(data => {
        window.electron.writeTerminal(connectionId, data);
      });

      // Store cleanup function
      const cleanup = window.electron.onTerminalData((_, { id, data }) => {
        if (id === connectionId) {
          term.write(data);
        }
      });

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

      const nativeContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const selection = term.getSelection();
        setSelectionText(selection || '');
        setHasSelection(!!selection && selection.length > 0);
        setMenuPos({ x: e.clientX, y: e.clientY });
      };

      containerRef.current?.addEventListener('contextmenu', nativeContextMenu);

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);

      // Cleanup function for useEffect
      return () => {
        containerRef.current?.removeEventListener('contextmenu', nativeContextMenu);
        try {
          cleanup();
        } catch (e) {
          console.warn('Terminal data listener cleanup failed:', e);
        }
        resizeObserver.disconnect();
        try {
          // Dispose terminal - wrapped in try-catch to handle WebGL addon issues
          if (term && !term.element?.parentElement) {
            // Terminal already detached from DOM, skip dispose
            console.log('Terminal already detached, skipping dispose');
          } else if (term) {
            term.dispose();
          }
        } catch (e) {
          console.warn('Terminal dispose failed (WebGL addon issue):', e);
        }
        termRef.current = null;
      };
    };

    // We need to manage cleanup manually since initTerminal is async
    let cleanupFn: (() => void) | undefined;
    initTerminal().then(fn => { cleanupFn = fn; });

    return () => {
      if (cleanupFn) cleanupFn();
    };
  }, [connectionId, rendererType]); // Only re-init if connectionId or renderer type changes (canvas vs webgl)

  const handleCopy = () => {
    if (selectionText) {
      navigator.clipboard.writeText(selectionText);
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
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: theme.terminal.background }}
      />

      {menuPos && (
        <TerminalContextMenu
          x={menuPos.x}
          y={menuPos.y}
          hasSelection={hasSelection}
          onCopy={handleCopy}
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
            window.electron?.writeTerminal(connectionId, cmd);
          }}
        />
      )}
    </div>
  );
}

