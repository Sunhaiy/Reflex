import { logger } from '../logger';
import { AgentFiles } from './files';
import { AgentShell, type ShellHost } from './shell';
import { buildSystemPrompt } from './prompt';
import { runAgent } from './loop';
import type { Message, Provider } from './providers/types';
import type { ConfigStore } from './config';
import type {
  AgentEvent,
  AgentMode,
  ApprovalAnswer,
  ApprovalQuestion,
} from '../../src/shared/agent';

export type { AgentEvent };

export type AgentHost = ShellHost;


export type AgentEmitter = (sessionId: string, conversationId: string, event: AgentEvent) => void;

export interface SendOptions {
  /** The SSH connection whose shell and files this conversation uses. */
  sessionId: string;
  /** Stable saved-server id used to restore history after a new SSH session is created. */
  connectionId: string;
  /** A renderer-owned Agent conversation living on that SSH connection. */
  conversationId: string;
  serverLabel: string;
  message: string;
  mode: AgentMode;
  localRoot: string | null;
  provider: Provider;
  contextBudget: number;
}

const MODEL_HISTORY_KEY = 'agentModelHistories';
const MAX_SAVED_CONVERSATIONS = 30;

interface StoredModelHistory {
  updatedAt: number;
  messages: Message[];
}

type StoredModelHistories = Record<string, Record<string, StoredModelHistory>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || !['user', 'assistant', 'tool'].includes(String(value.role))) return false;
  if (!Array.isArray(value.parts)) return false;
  return value.parts.every((part) => {
    if (!isRecord(part) || typeof part.type !== 'string') return false;
    if (part.type === 'text') return typeof part.text === 'string';
    if (part.type === 'tool_call') {
      return typeof part.id === 'string' && typeof part.name === 'string' && isRecord(part.input);
    }
    if (part.type === 'tool_result') {
      return typeof part.id === 'string' && typeof part.content === 'string';
    }
    return false;
  });
}

function readModelHistory(
  store: ConfigStore,
  connectionId: string,
  conversationId: string,
): Message[] {
  const all = store.get(MODEL_HISTORY_KEY);
  if (!isRecord(all)) return [];
  const server = all[connectionId];
  if (!isRecord(server)) return [];
  const saved = server[conversationId];
  if (!isRecord(saved) || !Array.isArray(saved.messages)) return [];
  return saved.messages.filter(isMessage);
}

function saveModelHistory(
  store: ConfigStore,
  connectionId: string,
  conversationId: string,
  messages: Message[],
) {
  const current = store.get(MODEL_HISTORY_KEY);
  const all: StoredModelHistories = isRecord(current)
    ? { ...(current as StoredModelHistories) }
    : {};
  const existingServer = isRecord(all[connectionId]) ? all[connectionId] : {};
  const server = {
    ...existingServer,
    [conversationId]: { updatedAt: Date.now(), messages },
  };
  const kept = Object.entries(server)
    .sort(([, a], [, b]) => Number(b.updatedAt) - Number(a.updatedAt))
    .slice(0, MAX_SAVED_CONVERSATIONS);
  all[connectionId] = Object.fromEntries(kept);
  store.set(MODEL_HISTORY_KEY, all);
}

function deleteModelHistory(
  store: ConfigStore,
  connectionId: string,
  conversationId: string,
) {
  const current = store.get(MODEL_HISTORY_KEY);
  if (!isRecord(current)) return;

  const all: StoredModelHistories = { ...(current as StoredModelHistories) };
  const existingServer = all[connectionId];
  if (!isRecord(existingServer) || !(conversationId in existingServer)) return;

  const server = { ...existingServer };
  delete server[conversationId];
  if (Object.keys(server).length > 0) all[connectionId] = server;
  else delete all[connectionId];
  store.set(MODEL_HISTORY_KEY, all);
}

/**
 * One Agent conversation, holding its own history and tool channels while using the SSH
 * connection it was created for. Several conversations may therefore stay alive on the
 * same server without mixing their model context or streamed events.
 */
class AgentConversation {
  history: Message[];
  readonly shell: AgentShell;
  readonly files: AgentFiles;
  private abort: AbortController | null = null;
  private disposed = false;
  private readonly waiting = new Map<string, (answer: ApprovalAnswer) => void>();

  constructor(
    host: AgentHost,
    readonly sessionId: string,
    readonly connectionId: string,
    private readonly conversationId: string,
    private readonly store: ConfigStore,
  ) {
    try {
      this.history = readModelHistory(store, connectionId, conversationId);
    } catch (error) {
      logger.error('[Agent] Could not restore model history', error);
      this.history = [];
    }
    this.shell = new AgentShell(host, sessionId);
    this.files = new AgentFiles(host, sessionId);
  }

  get busy() {
    return this.abort !== null;
  }

  async send(options: SendOptions, emit: AgentEmitter): Promise<void> {
    if (this.abort) throw new Error('This agent is already working on something');

    const controller = new AbortController();
    this.abort = controller;
    this.history.push({ role: 'user', parts: [{ type: 'text', text: options.message }] });
    this.checkpoint(this.history);

    try {
      const outcome = await runAgent(this.history, {
        provider: options.provider,
        system: buildSystemPrompt({
          mode: options.mode,
          localRoot: options.localRoot,
          serverLabel: options.serverLabel,
        }),
        mode: options.mode,
        contextBudget: options.contextBudget,
        context: {
          shell: this.shell,
          files: this.files,
          mode: options.mode,
          localRoot: options.localRoot,
          report: () => { /* replaced per call by the loop */ },
          signal: controller.signal,
        },
        signal: controller.signal,
        onCheckpoint: (messages) => {
          if (this.disposed) return;
          this.history = messages;
          this.checkpoint(messages);
        },
        events: {
          onText: (delta) => emit(this.sessionId, this.conversationId, { type: 'text', delta }),
          onToolStart: (call) => emit(this.sessionId, this.conversationId, {
            type: 'tool_start', callId: call.id, tool: call.name, input: call.input,
          }),
          onToolOutput: (callId, chunk, terminalChunk) => emit(this.sessionId, this.conversationId, {
            type: 'tool_output', callId, chunk, terminalChunk,
          }),
          onToolEnd: (callId, output, isError) => emit(this.sessionId, this.conversationId, {
            type: 'tool_end', callId, output, isError,
          }),
          onUsage: (usage) => emit(this.sessionId, this.conversationId, { type: 'usage', ...usage }),
          onCompacted: () => emit(this.sessionId, this.conversationId, { type: 'compacted' }),
          ask: (question) => this.askUser(question, emit),
        },
      });

      // Deletion or SSH teardown may land just as the provider resolves. Do not let the
      // completed microtask recreate history that the user has already removed.
      if (this.disposed) return;
      this.history = outcome.messages;
      this.checkpoint(this.history);
      emit(this.sessionId, this.conversationId, { type: 'done', stopReason: outcome.stopReason, turns: outcome.turns });
    } catch (error) {
      if (this.disposed) return;
      if (controller.signal.aborted) {
        emit(this.sessionId, this.conversationId, { type: 'done', stopReason: 'aborted', turns: 0 });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Agent] Run failed for ${this.sessionId}`, error);
      emit(this.sessionId, this.conversationId, { type: 'error', message });
    } finally {
      this.abort = null;
      // A cancel that lands mid-question would otherwise leave the loop parked forever.
      this.releaseWaiting('deny');
    }
  }

  private checkpoint(messages: Message[]) {
    try {
      saveModelHistory(this.store, this.connectionId, this.conversationId, messages);
    } catch (error) {
      // History recovery must not turn a successful server operation into a failure.
      logger.error('[Agent] Could not save model history', error);
    }
  }

  private askUser(question: ApprovalQuestion, emit: AgentEmitter): Promise<ApprovalAnswer> {
    return new Promise((resolve) => {
      this.waiting.set(question.callId, resolve);
      emit(this.sessionId, this.conversationId, { type: 'approval', question });
    });
  }

  answer(callId: string, answer: ApprovalAnswer): boolean {
    const resolve = this.waiting.get(callId);
    if (!resolve) return false;
    this.waiting.delete(callId);
    resolve(answer);
    return true;
  }

  cancel() {
    this.abort?.abort();
    this.releaseWaiting('deny');
  }

  private releaseWaiting(answer: ApprovalAnswer) {
    for (const resolve of this.waiting.values()) resolve(answer);
    this.waiting.clear();
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.shell.dispose();
    this.files.dispose();
  }
}

/** Owns the independent Agent conversations and routes IPC into each one. */
export class AgentService {
  private readonly conversations = new Map<string, AgentConversation>();

  constructor(
    private readonly host: AgentHost,
    private readonly emit: AgentEmitter,
    private readonly store: ConfigStore,
  ) { }

  private conversation(options: SendOptions): AgentConversation {
    const existing = this.conversations.get(options.conversationId);
    if (existing) {
      if (existing.sessionId !== options.sessionId) {
        throw new Error('This Agent conversation belongs to another SSH session');
      }
      if (existing.connectionId !== options.connectionId) {
        throw new Error('This Agent conversation belongs to another saved server');
      }
      return existing;
    }
    const created = new AgentConversation(
      this.host,
      options.sessionId,
      options.connectionId,
      options.conversationId,
      this.store,
    );
    this.conversations.set(options.conversationId, created);
    return created;
  }

  send(options: SendOptions): Promise<void> {
    return this.conversation(options).send(options, this.emit);
  }

  answer(conversationId: string, callId: string, answer: ApprovalAnswer): boolean {
    return this.conversations.get(conversationId)?.answer(callId, answer) ?? false;
  }

  cancel(conversationId: string) {
    this.conversations.get(conversationId)?.cancel();
  }

  /** Cancels a live run and removes the model-facing context saved for this server. */
  delete(conversationId: string, connectionId: string): boolean {
    const conversation = this.conversations.get(conversationId);
    if (conversation && conversation.connectionId !== connectionId) return false;
    this.dispose(conversationId);
    deleteModelHistory(this.store, connectionId, conversationId);
    return true;
  }

  isBusy(conversationId: string) {
    return this.conversations.get(conversationId)?.busy ?? false;
  }

  private dispose(conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    this.conversations.delete(conversationId);
    conversation.dispose();
  }

  /** Called when an SSH session goes away; returns every event route it owned. */
  disposeForSession(sessionId: string): string[] {
    const ids = [...this.conversations.entries()]
      .filter(([, conversation]) => conversation.sessionId === sessionId)
      .map(([conversationId]) => conversationId);
    for (const conversationId of ids) {
      const conversation = this.conversations.get(conversationId);
      if (conversation?.busy) {
        this.emit(sessionId, conversationId, { type: 'done', stopReason: 'aborted', turns: 0 });
      }
      this.dispose(conversationId);
    }
    return ids;
  }

  disposeAll() {
    for (const conversationId of [...this.conversations.keys()]) this.dispose(conversationId);
  }
}
