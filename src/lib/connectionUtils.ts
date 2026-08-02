import type { SSHConnection } from '../shared/types';

export const CONNECTION_RETRY_ATTEMPTS = 3;
const CONNECTION_RETRY_BASE_MS = 1000;

/**
 * Exponential with jitter rather than a fixed gap. The aborts seen against a throttled
 * host come from arriving too fast, and a constant retry keeps arriving at exactly the
 * same cadence; widening gaps give the server room to accept.
 */
export function retryDelay(attempt: number) {
  const backoff = CONNECTION_RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.round(backoff * (0.75 + Math.random() * 0.5));
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fills in what the form leaves blank, matching what the card ends up displaying. */
export function normalizeConnection(data: SSHConnection): SSHConnection {
  const username = data.username || 'root';
  return {
    ...data,
    id: data.id || crypto.randomUUID(),
    name: data.name || (data.host ? `${username}@${data.host}` : 'New Server'),
    username,
  };
}

/**
 * Whether an edit changed anything the open SSH session is built on. Renaming a
 * connection should not drop its shell; changing the host has to.
 */
export function connectionTransportChanged(previous: SSHConnection, next: SSHConnection) {
  const transportFields: Array<keyof SSHConnection> = [
    'host',
    'port',
    'username',
    'authType',
    'password',
    'privateKeyPath',
    'passphrase',
  ];
  return transportFields.some((field) => previous[field] !== next[field]);
}

/** Asks the terminal for this session to refit and repaint on the next frame. */
export function refreshTerminal(sessionId: string) {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('terminal-refresh', { detail: { connectionId: sessionId } }));
  });
}
