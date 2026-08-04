import { logger } from '../logger';
import { AgentFiles } from './files';
import { AgentShell, type ShellHost } from './shell';
import { buildSystemPrompt } from './prompt';
import { runAgent } from './loop';
import type { Message, Provider } from './providers/types';
import type {
  AgentEvent,
  AgentMode,
  ApprovalAnswer,
  ApprovalQuestion,
} from '../../src/shared/agent';

export type { AgentEvent };

export interface AgentHost extends ShellHost { }


export type AgentEmitter = (sessionId: string, event: AgentEvent) => void;

export interface SendOptions {
  sessionId: string;
  serverLabel: string;
  message: string;
  mode: AgentMode;
  localRoot: string | null;
  provider: Provider;
  contextBudget: number;
}

/**
 * One conversation per SSH session, holding the history and the two channels the tools
 * work through. Both channels are torn down with the session, so nothing the agent set up
 * in its shell survives into an unrelated task.
 */
class AgentConversation {
  history: Message[] = [];
  readonly shell: AgentShell;
  readonly files: AgentFiles;
  private abort: AbortController | null = null;
  private readonly waiting = new Map<string, (answer: ApprovalAnswer) => void>();

  constructor(host: AgentHost, private readonly sessionId: string) {
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
          localRoot: options.localRoot,
          report: () => { /* replaced per call by the loop */ },
          signal: controller.signal,
        },
        signal: controller.signal,
        events: {
          onText: (delta) => emit(this.sessionId, { type: 'text', delta }),
          onToolStart: (call) => emit(this.sessionId, {
            type: 'tool_start', callId: call.id, tool: call.name, input: call.input,
          }),
          onToolOutput: (callId, chunk) => emit(this.sessionId, { type: 'tool_output', callId, chunk }),
          onToolEnd: (callId, output, isError) => emit(this.sessionId, {
            type: 'tool_end', callId, output, isError,
          }),
          onUsage: (usage) => emit(this.sessionId, { type: 'usage', ...usage }),
          onCompacted: () => emit(this.sessionId, { type: 'compacted' }),
          ask: (question) => this.askUser(question, emit),
        },
      });

      this.history = outcome.messages;
      emit(this.sessionId, { type: 'done', stopReason: outcome.stopReason, turns: outcome.turns });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Agent] Run failed for ${this.sessionId}`, error);
      emit(this.sessionId, { type: 'error', message });
    } finally {
      this.abort = null;
      // A cancel that lands mid-question would otherwise leave the loop parked forever.
      this.releaseWaiting('deny');
    }
  }

  private askUser(question: ApprovalQuestion, emit: AgentEmitter): Promise<ApprovalAnswer> {
    return new Promise((resolve) => {
      this.waiting.set(question.callId, resolve);
      emit(this.sessionId, { type: 'approval', question });
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
    this.cancel();
    this.shell.dispose();
    this.files.dispose();
  }
}

/** Owns one conversation per SSH session and routes IPC into it. */
export class AgentService {
  private readonly conversations = new Map<string, AgentConversation>();

  constructor(private readonly host: AgentHost, private readonly emit: AgentEmitter) { }

  private conversation(sessionId: string): AgentConversation {
    const existing = this.conversations.get(sessionId);
    if (existing) return existing;
    const created = new AgentConversation(this.host, sessionId);
    this.conversations.set(sessionId, created);
    return created;
  }

  send(options: SendOptions): Promise<void> {
    return this.conversation(options.sessionId).send(options, this.emit);
  }

  answer(sessionId: string, callId: string, answer: ApprovalAnswer): boolean {
    return this.conversations.get(sessionId)?.answer(callId, answer) ?? false;
  }

  cancel(sessionId: string) {
    this.conversations.get(sessionId)?.cancel();
  }

  isBusy(sessionId: string) {
    return this.conversations.get(sessionId)?.busy ?? false;
  }

  /** Forgets the conversation without touching the SSH session it ran on. */
  reset(sessionId: string) {
    this.dispose(sessionId);
  }

  /** Called when the SSH session goes away; the channels are already dead by then. */
  dispose(sessionId: string) {
    const conversation = this.conversations.get(sessionId);
    if (!conversation) return;
    this.conversations.delete(sessionId);
    conversation.dispose();
  }

  disposeAll() {
    for (const sessionId of [...this.conversations.keys()]) this.dispose(sessionId);
  }
}
