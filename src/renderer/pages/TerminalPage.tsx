import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function TerminalPage() {
  const location = useLocation();
  const connectionId = location.state?.connectionId;
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || !connectionId) return;

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
      window.electron.writeTerminal(connectionId, data);
    });

    // Handle incoming data
    const cleanup = window.electron.onTerminalData((event, { id, data }) => {
      if (id === connectionId) {
        term.write(data);
      }
    });
    
    // Resize handler
    const handleResize = () => {
      fitAddon.fit();
      if (xtermRef.current) {
         window.electron.resizeTerminal(connectionId, xtermRef.current.cols, xtermRef.current.rows);
      }
    };
    
    window.addEventListener('resize', handleResize);
    // Initial resize after a small delay to ensure container is ready
    setTimeout(handleResize, 100);

    return () => {
      cleanup();
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [connectionId]);

  if (!connectionId) {
    return <div className="p-4 text-gray-500">No active connection selected. Please connect from the Connections page.</div>;
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 p-2 rounded-lg border border-slate-800">
       <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
