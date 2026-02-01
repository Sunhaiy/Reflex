import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  connectionId: string;
}

export function TerminalView({ connectionId }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || !connectionId) return;

    // Clean up previous terminal if exists
    if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
    }

    try {
        const term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Consolas, monospace',
          theme: {
            background: '#0f172a', // slate-900
            foreground: '#e2e8f0', // slate-200
          }
        });
        
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();
        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Handle user input
        term.onData((data) => {
          if (window.electron) {
              window.electron.writeTerminal(connectionId, data);
          }
        });

        // Handle incoming data
        let cleanup = () => {};
        if (window.electron) {
             cleanup = window.electron.onTerminalData((event, { id, data }) => {
              if (id === connectionId) {
                term.write(data);
              }
            });
        }
        
        // Resize handler
        const handleResize = () => {
          try {
            fitAddon.fit();
            if (xtermRef.current && window.electron) {
                window.electron.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch (e) {
              console.warn('Resize failed', e);
          }
        };
        
        window.addEventListener('resize', handleResize);
        // Initial resize after a small delay to ensure container is ready
        const timer = setTimeout(handleResize, 100);

        return () => {
          cleanup();
          window.removeEventListener('resize', handleResize);
          clearTimeout(timer);
          term.dispose();
          xtermRef.current = null;
        };
    } catch (err) {
        console.error("Terminal initialization error:", err);
    }
  }, [connectionId]);

  if (!connectionId) {
    return (
        <div className="h-full flex flex-col bg-slate-900 rounded-lg border border-slate-800 items-center justify-center text-slate-500">
            Terminal disconnected
        </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
       <div ref={terminalRef} className="flex-1 overflow-hidden p-2" />
    </div>
  );
}
