import { useEffect, useRef, useState } from 'react';
import { activityLine } from '../components/ActivityLog';
import { appendActivity, clearActivity } from '../lib/activityStore';
import { CONNECTION_RETRY_ATTEMPTS, refreshTerminal, retryDelay, wait } from '../lib/connectionUtils';
import { errorMessage } from '../lib/errors';
import { useConnectionUsage } from './useConnectionUsage';
import { useTranslation } from './useTranslation';
import type { Session, SessionStatus, SSHConnection } from '../shared/types';

interface SessionOptions {
  /** A session moved to the front and should be on screen. */
  openWorkspace: () => void;
  /** Nothing is left for the workspace to show. */
  leaveWorkspace: () => void;
  /** A connection just came up, however it was started — including a restored one. */
  onConnected: (connection: SSHConnection) => void;
}

/**
 * The open SSH sessions and everything that changes their number or state: connecting
 * with retries, reconnecting, closing, and restoring the set that was open last time.
 *
 * Which page is showing is not this hook's business, so the two moments that have to
 * move the user arrive as callbacks instead.
 */
export function useSessions({ openWorkspace, leaveWorkspace, onConnected }: SessionOptions) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const autoConnectedRef = useRef(false);

  const { t } = useTranslation();
  const { startConnectionUsage, finishConnectionUsage } = useConnectionUsage();

  useEffect(() => {
    return window.electron.onSSHStatus((_event, { id, status }) => {
      if (status === 'connected') startConnectionUsage(id);
      if (status === 'disconnected') finishConnectionUsage(id);
      setSessions((current) => current.map((session) =>
        session.uniqueId === id
          ? {
            ...session,
            status: status as SessionStatus,
            connectedAt: status === 'connected' ? (session.connectedAt || Date.now()) : undefined,
          }
          : session
      ));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skipped until the restore below has run, so an empty starting list never overwrites
  // the set of sessions that is about to be reopened.
  useEffect(() => {
    if (!restoredRef.current) return;
    const active = sessions.find((item) => item.uniqueId === activeSessionId);
    void window.electron.storeSet('openSessions', {
      ids: sessions.map((item) => item.connection.id),
      activeId: active?.connection.id ?? null,
    });
  }, [activeSessionId, sessions]);

  const connect = async (connection: SSHConnection) => {
    const uniqueId = crypto.randomUUID();
    setSessions((current) => [...current, { uniqueId, connection, status: 'connecting' }]);
    setActiveSessionId(uniqueId);
    openWorkspace();

    let result: { success: boolean; error?: string } = { success: false, error: 'Connection failed' };
    for (let attempt = 1; attempt <= CONNECTION_RETRY_ATTEMPTS; attempt += 1) {
      try {
        result = await window.electron.connectSSH({ connection, sessionId: uniqueId });
      } catch (caught) {
        result = { success: false, error: errorMessage(caught, 'Connection failed') };
      }

      if (result.success) break;
      if (attempt < CONNECTION_RETRY_ATTEMPTS) {
        const delay = retryDelay(attempt);
        // The overlay is otherwise silent through every attempt and its backoff, which
        // is what made a slow connect look like a hang.
        appendActivity('session', uniqueId, activityLine(
          `Attempt ${attempt} of ${CONNECTION_RETRY_ATTEMPTS} failed: ${result.error || 'unknown error'}`,
          'error',
        ));
        appendActivity('session', uniqueId, activityLine(
          `Retrying in ${(delay / 1000).toFixed(1)}s...`,
          'dim',
        ));
        await wait(delay);
      }
    }

    if (result.success) {
      setError(null);
      const connectedAt = startConnectionUsage(uniqueId);
      setSessions((current) => current.map((session) =>
        session.uniqueId === uniqueId ? { ...session, status: 'connected', connectedAt } : session
      ));
      onConnected(connection);
      return;
    }

    setSessions((current) => current.filter((session) => session.uniqueId !== uniqueId));
    setActiveSessionId(null);
    leaveWorkspace();
    setError(t('shell.connectFailedRetry', {
      count: CONNECTION_RETRY_ATTEMPTS,
      error: result.error || 'Unknown error',
    }));
  };

  const reconnect = async (sessionId: string) => {
    setSessions((current) => current.map((session) =>
      session.uniqueId === sessionId ? { ...session, status: 'connecting' } : session
    ));

    const result = await window.electron.sshReconnect(sessionId);
    if (!result.success) {
      setSessions((current) => current.map((session) =>
        session.uniqueId === sessionId ? { ...session, status: 'disconnected', connectedAt: undefined } : session
      ));
      setError(t('shell.reconnectFailed', { error: result.error || 'Unknown error' }));
      return;
    }

    const connectedAt = startConnectionUsage(sessionId);
    setSessions((current) => current.map((session) =>
      session.uniqueId === sessionId ? { ...session, status: 'connected', connectedAt } : session
    ));
  };

  /** Brings an already-open session forward, waking it first if it has dropped. */
  const focusSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    openWorkspace();
    const session = sessions.find((item) => item.uniqueId === sessionId);
    if (session?.status === 'disconnected') void reconnect(sessionId);
    refreshTerminal(sessionId);
  };

  /** Opens a saved connection, reusing its session when one is already up. */
  const openConnection = (connection: SSHConnection) => {
    const existing = sessions.find((session) => session.connection.id === connection.id);
    if (existing) {
      focusSession(existing.uniqueId);
      return;
    }
    void connect(connection);
  };

  const closeSession = async (sessionId: string) => {
    await window.electron.disconnectSSH(sessionId).catch(() => undefined);
    finishConnectionUsage(sessionId);
    clearActivity(sessionId);
    const remaining = sessions.filter((session) => session.uniqueId !== sessionId);
    setSessions(remaining);

    if (activeSessionId !== sessionId) return;
    const next = remaining[remaining.length - 1];
    setActiveSessionId(next?.uniqueId || null);
    if (!next) leaveWorkspace();
  };

  /** Carries an edited connection into its live session without dropping the shell. */
  const applyConnectionEdit = (connection: SSHConnection) => {
    setSessions((current) => current.map((session) =>
      session.connection.id === connection.id ? { ...session, connection } : session
    ));
  };

  // Reopening what was open last time. `connect` is reached through a ref because this
  // effect deliberately runs once, and the version it captured on the first render would
  // otherwise be the one used for every restored session.
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;

    void (async () => {
      try {
        const autoReconnect = await window.electron.storeGet('autoReconnect');
        if (!autoReconnect) return;

        // Saved connections are read straight from the store rather than from state,
        // because this runs alongside the restore that populates that state.
        const [storedSessions, storedConnections] = await Promise.all([
          window.electron.storeGet('openSessions'),
          window.electron.storeGet('connections'),
        ]);
        const available = Array.isArray(storedConnections) ? storedConnections as SSHConnection[] : [];

        const saved = storedSessions as { ids?: unknown; activeId?: unknown } | undefined;
        const ids = Array.isArray(saved?.ids)
          ? (saved.ids as unknown[]).filter((id): id is string => typeof id === 'string')
          : [];

        // Sequential on purpose: every tab appears immediately in 'connecting' state, so
        // the workspace is visibly whole right away, while the handshakes queue up rather
        // than arriving at one host all at once.
        for (const id of ids) {
          const connection = available.find((item) => item.id === id);
          if (connection) await connectRef.current(connection);
        }

        const activeId = typeof saved?.activeId === 'string' ? saved.activeId : null;
        if (activeId) {
          setSessions((current) => {
            const target = current.find((item) => item.connection.id === activeId);
            if (target) setActiveSessionId(target.uniqueId);
            return current;
          });
        }
      } finally {
        restoredRef.current = true;
      }
    })();
    // Runs once when the shell starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessions,
    activeSessionId,
    error,
    dismissError: () => setError(null),
    connect,
    focusSession,
    openConnection,
    closeSession,
    applyConnectionEdit,
  };
}
