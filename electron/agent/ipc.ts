import { dialog, ipcMain, type WebContents } from 'electron';
import type { Client } from 'ssh2';
import { AgentService } from './service';
import {
  createProvider,
  getConfigView,
  listModels,
  saveConfig,
  selectProvider,
  testConnection,
  type ConfigStore,
} from './config';
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
  const conversationViewsKey = 'agentConversationViews';
  /** Where each Agent conversation's events go. */
  const senders = new Map<string, WebContents>();

  const service = new AgentService(host, (sessionId, conversationId, event) => {
    const target = senders.get(conversationId);
    if (!target || target.isDestroyed()) return;
    target.send('agent-event', { sessionId, conversationId, event });
  }, store);

  ipcMain.handle('agent-config-get', () => getConfigView(store));

  ipcMain.handle('agent-config-set', (event, patch: Partial<AgentConfig> & { apiKey?: string }) => {
    saveConfig(store, patch ?? {});
    const view = getConfigView(store);
    event.sender.send('agent-config-changed', view);
    return view;
  });

  ipcMain.handle('agent-test', () => testConnection(store));

  ipcMain.handle('agent-models', async (event) => {
    const result = await listModels(store);
    if (result.ok) event.sender.send('agent-config-changed', getConfigView(store));
    return result;
  });

  // Conversation UI is stored behind a dedicated channel so it can be updated
  // atomically per server without exposing the main process's model history record.
  ipcMain.handle('agent-conversations-get', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 128) return null;
    const stored = store.get(conversationViewsKey);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    return (stored as Record<string, unknown>)[connectionId] ?? null;
  });

  ipcMain.handle('agent-provider-select', (event, providerId: string) => {
    const view = selectProvider(store, typeof providerId === 'string' ? providerId : '');
    event.sender.send('agent-config-changed', view);
    return view;
  });

  ipcMain.handle('agent-conversations-set', (_event, payload: {
    connectionId?: unknown;
    value?: unknown;
  }) => {
    const connectionId = payload?.connectionId;
    if (typeof connectionId !== 'string' || !connectionId || connectionId.length > 128) return;
    const stored = store.get(conversationViewsKey);
    const views = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};
    views[connectionId] = payload.value;
    store.set(conversationViewsKey, views);
  });

  ipcMain.handle('agent-send', async (event, payload: {
    sessionId: string;
    connectionId: string;
    conversationId: string;
    serverLabel: string;
    message: string;
    localRoot: string | null;
  }) => {
    const { sessionId, connectionId, conversationId, serverLabel, message, localRoot } = payload;
    if (!sessionId || !connectionId || !conversationId || typeof message !== 'string' || !message.trim()) {
      return { ok: false as const, error: 'Nothing to send' };
    }
    if (service.isBusy(conversationId)) {
      return { ok: false as const, error: 'The agent is still working on the last message' };
    }

    senders.set(conversationId, event.sender);

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
      connectionId,
      conversationId,
      serverLabel: serverLabel || 'this server',
      message,
      mode: getConfigView(store).mode,
      contextBudget: getConfigView(store).contextBudget,
      localRoot: localRoot || null,
      provider,
    });

    return { ok: true as const };
  });

  ipcMain.handle('agent-answer', (_event, payload: {
    conversationId: string;
    callId: string;
    answer: ApprovalAnswer;
  }) => service.answer(payload.conversationId, payload.callId, payload.answer));

  ipcMain.on('agent-cancel', (_event, conversationId: string) => service.cancel(conversationId));

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
      for (const conversationId of service.disposeForSession(sessionId)) {
        senders.delete(conversationId);
      }
    },
    disposeAll() {
      service.disposeAll();
      senders.clear();
    },
  };
}
