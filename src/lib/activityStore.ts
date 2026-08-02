import { useSyncExternalStore } from 'react';
import type { ActivityLine, ActivityScope } from '../shared/types';

const MAX_LINES = 200;
const EMPTY: ActivityLine[] = [];

const byKey = new Map<string, ActivityLine[]>();
const listeners = new Set<() => void>();
let started = false;

function key(scope: ActivityScope, sessionId: string) {
    return `${scope}:${sessionId}`;
}

function notify() {
    listeners.forEach((listener) => listener());
}

function append(mapKey: string, line: ActivityLine) {
    const next = [...(byKey.get(mapKey) ?? []), line];
    byKey.set(mapKey, next.length > MAX_LINES ? next.slice(-MAX_LINES) : next);
    notify();
}

/**
 * Subscribes once at startup so lines emitted before a panel mounts are not lost —
 * connect progress starts arriving the moment the session is created.
 */
export function startActivityCapture() {
    if (started) return;
    started = true;
    window.electron.onSSHActivity(({ id, scope, line }) => append(key(scope, id), line));
}

/**
 * Appends a line produced in the renderer. Connection retries are driven here, not in
 * the main process, so without this the overlay showed nothing while three attempts and
 * their backoff went by — the wait had no explanation.
 */
export function appendActivity(scope: ActivityScope, sessionId: string, line: ActivityLine) {
    append(key(scope, sessionId), line);
}

export function clearActivity(sessionId: string) {
    let changed = false;
    for (const scope of ['session', 'monitor'] as const) {
        if (byKey.delete(key(scope, sessionId))) changed = true;
    }
    if (changed) notify();
}

export function useActivityLines(scope: ActivityScope, sessionId: string) {
    return useSyncExternalStore(
        (onChange) => {
            listeners.add(onChange);
            return () => listeners.delete(onChange);
        },
        () => byKey.get(key(scope, sessionId)) ?? EMPTY,
    );
}
