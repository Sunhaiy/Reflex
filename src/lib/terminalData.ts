type TerminalDataListener = (data: string) => void;

const listeners = new Map<string, Set<TerminalDataListener>>();
let unsubscribeIpc: (() => void) | undefined;

function ensureIpcSubscription() {
  if (unsubscribeIpc) return;
  unsubscribeIpc = window.electron.onTerminalData((_, { id, data }) => {
    for (const listener of listeners.get(id) ?? []) listener(data);
  });
}

/** Shares one renderer IPC listener between every mounted terminal. */
export function subscribeTerminalData(connectionId: string, listener: TerminalDataListener) {
  ensureIpcSubscription();
  const connectionListeners = listeners.get(connectionId) ?? new Set<TerminalDataListener>();
  connectionListeners.add(listener);
  listeners.set(connectionId, connectionListeners);

  return () => {
    connectionListeners.delete(listener);
    if (connectionListeners.size === 0) listeners.delete(connectionId);
    if (listeners.size === 0) {
      unsubscribeIpc?.();
      unsubscribeIpc = undefined;
    }
  };
}
