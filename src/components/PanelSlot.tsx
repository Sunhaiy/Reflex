// PanelSlot - Shared panel instances between Normal and Agent modes.
//
// Same pattern as TerminalSlot: create stable DOM containers once, render React
// components into them via portal, and reparent via appendChild when the active
// consumer changes (e.g. switching from Normal to Agent mode).
//
// Shared panels: SystemMonitor, FileBrowser, DockerManager.

import { useRef, useEffect, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { SystemMonitor } from './SystemMonitor';
import { FileBrowser } from './FileBrowser';
import { DockerManager } from './DockerManager';
import { ErrorBoundary } from './ErrorBoundary';
import { SSHConnection } from '../shared/types';

export type PanelName = 'monitor' | 'files' | 'docker';

interface PanelSlots {
    monitor: HTMLDivElement;
    files: HTMLDivElement;
    docker: HTMLDivElement;
}

const PanelSlotContext = createContext<PanelSlots | null>(null);

interface PanelSlotProviderProps {
    children: React.ReactNode;
    connectionId: string;
    isConnected: boolean;
    connection: SSHConnection;
}

function createStableDiv() {
    const div = document.createElement('div');
    div.style.cssText = 'width:100%;height:100%;';
    return div;
}

export function PanelSlotProvider({ children, connectionId, isConnected, connection: _connection }: PanelSlotProviderProps) {
    const slotsRef = useRef<PanelSlots | null>(null);
    if (!slotsRef.current) {
        slotsRef.current = {
            monitor: createStableDiv(),
            files: createStableDiv(),
            docker: createStableDiv(),
        };
    }
    const slots = slotsRef.current;

    return (
        <PanelSlotContext.Provider value={slots}>
            {createPortal(
                <ErrorBoundary name="SystemMonitor">
                    <SystemMonitor connectionId={connectionId} />
                </ErrorBoundary>,
                slots.monitor
            )}
            {createPortal(
                <ErrorBoundary name="FileBrowser">
                    <FileBrowser connectionId={connectionId} isConnected={isConnected} />
                </ErrorBoundary>,
                slots.files
            )}
            {createPortal(
                <ErrorBoundary name="DockerManager">
                    <DockerManager connectionId={connectionId} />
                </ErrorBoundary>,
                slots.docker
            )}
            {children}
        </PanelSlotContext.Provider>
    );
}

export function PanelSlotConsumer({ panel, active = true }: { panel: PanelName; active?: boolean }) {
    const slots = useContext(PanelSlotContext);
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!slots || !mountRef.current || !active) return;
        const container = slots[panel];
        const parent = mountRef.current;
        parent.appendChild(container);

        return () => {
            try {
                if (container.parentElement === parent) {
                    parent.removeChild(container);
                }
            } catch (_) { }
        };
    }, [slots, panel, active]);

    return (
        <div
            ref={mountRef}
            className="h-full w-full relative overflow-hidden"
            style={{ minHeight: 0 }}
        />
    );
}
