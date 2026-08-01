import { useSyncExternalStore } from 'react';

/**
 * Whether the shell has finished restoring its state. The startup cover waits on this
 * rather than on a timer, so it leaves when the real work is done.
 */
let ready = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Marks the shell as usable; the cover only leaves after this. */
export function bootReady() {
    if (ready) return;
    ready = true;
    listeners.forEach((listener) => listener());
}

export function useBootReady() {
    return useSyncExternalStore(subscribe, () => ready);
}
