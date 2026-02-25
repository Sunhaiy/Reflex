// TerminalSlot - Stable DOM node for xterm that can be shared between two layouts.
//
// The xterm terminal's physical DOM element lives permanently in ONE place (the slot).
// Both Normal mode and Agent mode render a <TerminalSlotConsumer /> that is just a
// div ref target. When the active mode changes, we call appendChild() to physically
// move the terminal DOM node into the newly-active container div.
//
// This is completely safe for xterm because:
// - The xterm instance is never destroyed/re-created
// - The ResizeObserver on the container div fires after reparenting, triggering a fit
// - All IPC listeners are unchanged

import { useRef, useEffect, createContext, useContext } from 'react';
import { TerminalView } from './TerminalView';
import { ErrorBoundary } from './ErrorBoundary';
import { createPortal } from 'react-dom';

// Context stores a stable div element that holds the terminal
const TerminalSlotContext = createContext<HTMLDivElement | null>(null);

interface TerminalSlotProviderProps {
    children: React.ReactNode;
    connectionId: string;
    isVisible: boolean;
}

// Provider: owns the stable terminal wrapper div + manages its React tree
export function TerminalSlotProvider({ children, connectionId, isVisible }: TerminalSlotProviderProps) {
    // This div is created ONCE and never removed from the DOM
    const stableContainerRef = useRef<HTMLDivElement | null>(null);
    if (!stableContainerRef.current) {
        const div = document.createElement('div');
        div.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        stableContainerRef.current = div;
    }

    // When session becomes visible, fire a custom event so TerminalView can refresh
    const prevVisible = useRef(isVisible);
    useEffect(() => {
        if (!prevVisible.current && isVisible) {
            // session just became active — tell the terminal to re-render
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('terminal-refresh', { detail: { connectionId } }));
                window.dispatchEvent(new Event('resize'));
            }, 50);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
        }
        prevVisible.current = isVisible;
    }, [isVisible, connectionId]);

    return (
        <TerminalSlotContext.Provider value={stableContainerRef.current}>
            {/* Always render TerminalView — never unmount it when invisible.
                Hiding/showing is done by the session wrapper in App.tsx via CSS visibility. */}
            {createPortal(
                <ErrorBoundary name="Terminal">
                    <TerminalView connectionId={connectionId} />
                </ErrorBoundary>,
                stableContainerRef.current
            )}
            {children}
        </TerminalSlotContext.Provider>
    );
}

// Consumer: a placeholder div that adopts the stable terminal container as a child
export function TerminalSlotConsumer() {
    const stableContainer = useContext(TerminalSlotContext);
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!stableContainer || !mountRef.current) return;
        const parent = mountRef.current;
        parent.appendChild(stableContainer);

        // 3-frame resize sequence: first lets browser compute layout,
        // second ensures xterm canvas repaint, third catches stragglers.
        let r1: number, r2: number, r3: number;
        r1 = requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
            r2 = requestAnimationFrame(() => {
                window.dispatchEvent(new Event('resize'));
                r3 = requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
            });
        });

        return () => {
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2!);
            cancelAnimationFrame(r3!);
            try {
                if (stableContainer.parentElement === parent) {
                    parent.removeChild(stableContainer);
                }
            } catch (_) { }
        };
    }, [stableContainer]);

    return (
        <div
            ref={mountRef}
            className="h-full w-full relative overflow-hidden"
            style={{ minHeight: 0 }}
        />
    );
}
