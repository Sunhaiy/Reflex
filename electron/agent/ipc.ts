import { dialog, ipcMain, type WebContents } from 'electron';
import type { Client } from 'ssh2';
import { AgentService } from './service';
import { createProvider, getConfigView, saveConfig, testConnection, type ConfigStore } from './config';
import type { AgentConfig, ApprovalAnswer } from '../../src/shared/agent';

export interface AgentIpcHost {
  getConnection(sessionId: string): Client | undefined;
}

/**
 * Wires the agent to the renderer.
 *
 * Kept out of ipcHandlers.ts so that file stays about sessions and settings rather than
 * growing a second subsystem inside it.
 */
export function registerAgentHandlers(host: AgentIpcHost, store: ConfigStore) {
  /** Where each session's events go. Set on send, cleared when the session is disposed. */
  const senders = new Map<string, WebContents>();

  const service = new AgentService(host, (sessionId, event) => {
    const target = senders.get(sessionId);
    if (!target || target.isDestroyed()) return;
    target.send('agent-event', { sessionId, event });
  });

  ipcMain.handle('agent-config-get', () => getConfigView(store));

  ipcMain.handle('agent-config-set', (_event, patch: Partial<AgentConfig> & { apiKey?: string }) => {
    saveConfig(store, patch ?? {});
    return getConfigView(store);
  });

  ipcMain.handle('agent-test', () => testConnection(store));

  ipcMain.handle('agent-send', async (event, payload: {
    sessionId: string;
    serverLabel: string;
    message: string;
    localRoot: string | null;
  }) => {
    const { sessionId, serverLabel, message, localRoot } = payload;
    if (!sessionId || typeof message !== 'string' || !message.trim()) {
      return { ok: false as const, error: 'Nothing to send' };
    }
    if (service.isBusy(sessionId)) {
      return { ok: false as const, error: 'The agent is still working on the last message' };
    }

    senders.set(sessionId, event.sender);

    let provider;
    try {
      // Built per message rather than held, so a settings change takes effect at once.
      provider = createProvider(store);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }

    // Deliberately not awaited: the answer arrives as a stream of `agent-event`s, and
    // holding the invoke open for a ten-minute deployment would time it out.
    void service.send({
      sessionId,
      serverLabel: serverLabel || 'this server',
      message,
      mode: getConfigView(store).mode,
      localRoot: localRoot || null,
      provider,
    });

    return { ok: true as const };
  });

  ipcMain.handle('agent-answer', (_event, payload: {
    sessionId: string;
    callId: string;
    answer: ApprovalAnswer;
  }) => service.answer(payload.sessionId, payload.callId, payload.answer));

  ipcMain.on('agent-cancel', (_event, sessionId: string) => service.cancel(sessionId));

  ipcMain.handle('agent-reset', (_event, sessionId: string) => {
    service.reset(sessionId);
    senders.delete(sessionId);
  });

  ipcMain.handle('agent-pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose the project folder the agent may read',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  return {
    /** Called when an SSH session ends; its channels are already gone by then. */
    dispose(sessionId: string) {
      service.dispose(sessionId);
      senders.delete(sessionId);
    },
    disposeAll() {
      service.disposeAll();
      senders.clear();
    },
  };
}
