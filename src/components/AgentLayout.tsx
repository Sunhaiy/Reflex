// AgentLayout - Two-panel layout for Agent mode
import { useRef, useState, useEffect } from 'react';
import { AIChatPanel, AgentMessage } from './AIChatPanel';
import { ErrorBoundary } from './ErrorBoundary';

interface AgentLayoutProps {
    connectionId: string;
    messages: AgentMessage[];
    onMessagesChange: (messages: AgentMessage[]) => void;
    terminalContent: React.ReactNode;
}

export function AgentLayout({ connectionId, messages, onMessagesChange, terminalContent }: AgentLayoutProps) {
    const [chatWidth, setChatWidth] = useState(0.55); // 55% for chat
    const layoutRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);

    const handleExecuteCommand = (command: string) => {
        const eWindow = window as any;
        eWindow.electron?.writeTerminal(connectionId, command);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || !layoutRef.current) return;
            const bounds = layoutRef.current.getBoundingClientRect();
            const ratio = (e.clientX - bounds.left) / bounds.width;
            if (ratio > 0.3 && ratio < 0.8) {
                setChatWidth(ratio);
            }
        };

        const handleMouseUp = () => {
            if (isResizing.current) {
                window.dispatchEvent(new Event('resize'));
            }
            isResizing.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const startResize = () => {
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    return (
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden" style={{ padding: 'var(--panel-gap)' }}>
            {/* Left: AI Chat Panel */}
            <div
                className="h-full flex flex-col min-w-0 overflow-hidden"
                style={{ width: `${chatWidth * 100}%` }}
            >
                <div className="h-full bg-card/50 rounded-lg border border-border overflow-hidden flex flex-col">
                    <ErrorBoundary name="AIChatPanel">
                        <AIChatPanel
                            connectionId={connectionId}
                            messages={messages}
                            onMessagesChange={onMessagesChange}
                            onExecuteCommand={handleExecuteCommand}
                        />
                    </ErrorBoundary>
                </div>
            </div>

            {/* Resizer */}
            <div
                className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors bg-transparent relative z-10 flex-shrink-0 mx-0"
                onMouseDown={startResize}
            />

            {/* Right: Terminal Observation (passed from parent) */}
            <div
                className="h-full flex flex-col min-w-0 overflow-hidden"
                style={{ width: `${(1 - chatWidth) * 100}%` }}
            >
                <div className="h-full bg-card/50 rounded-lg border border-border overflow-hidden flex flex-col">
                    {/* Terminal Header */}
                    <div className="flex items-center px-3 py-1.5 border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                        终端观察
                    </div>
                    {/* Terminal - passed in from parent to share instance */}
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        {terminalContent}
                    </div>
                </div>
            </div>
        </div>
    );
}
