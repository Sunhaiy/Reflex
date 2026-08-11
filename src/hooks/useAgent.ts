import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { log } from '../lib/logger';
import { echoAgentCommand, echoAgentOutput, echoAgentResult } from '../lib/terminalEcho';
import type {
  AgentConfig,
  AgentConfigView,
  AgentEvent,
  AgentMode,
  ReasoningEffort,
  ApprovalAnswer,
  ApprovalQuestion,
} from '../shared/agent';

export type AgentBlock =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  | { kind: 'note'; id: string; text: string; tone: 'error' | 'muted' }
  | { kind: 'stopped'; id: string; turns: number }
  | { kind: 'compacted'; id: string }
  | {
    kind: 'tool';
    id: string;
    tool: string;
    input: Record<string, unknown>;
    output: string;
    result?: string;
    isError?: boolean;
    done: boolean;
  };

export interface AgentConversationSummary {
  id: string;
  title: string;
  busy: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AgentConversation extends AgentConversationSummary {
  blocks: AgentBlock[];
  pending: ApprovalQuestion | null;
  runStartedAt: number | null;
  contextTokens: number;
  spentTokens: number;
}

interface ConversationState {
  activeId: string;
  items: AgentConversation[];
}

let conversationSequence = 0;
let blockSequence = 0;
const MAX_SAVED_CONVERSATIONS = 30;

const nextBlockId = () => globalThis.crypto?.randomUUID?.() ?? `b${Date.now().toString(36)}-${++blockSequence}`;

function createUserBlock(text: string): AgentBlock {
  return { kind: 'user', id: nextBlockId(), text };
}

function createNoteBlock(text: string, tone: 'error' | 'muted'): AgentBlock {
  return { kind: 'note', id: nextBlockId(), text, tone };
}

function createConversation(): AgentConversation {
  const now = Date.now();
  const fallbackId = `agent-${now.toString(36)}-${++conversationSequence}`;
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    title: '',
    blocks: [],
    busy: false,
    pending: null,
    runStartedAt: null,
    contextTokens: 0,
    spentTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function deleteConversationFromState(
  state: ConversationState,
  conversationId: string,
): ConversationState {
  const deletedIndex = state.items.findIndex((item) => item.id === conversationId);
  if (deletedIndex < 0) return state;

  const items = state.items.filter((item) => item.id !== conversationId);
  if (items.length === 0) {
    const created = createConversation();
    return { activeId: created.id, items: [created] };
  }

  return {
    activeId: state.activeId === conversationId
      ? items[Math.min(deletedIndex, items.length - 1)].id
      : state.activeId,
    items,
  };
}

function settleText(blocks: AgentBlock[]): AgentBlock[] {
  return blocks.map((block) => (
    block.kind === 'text' && block.streaming ? { ...block, streaming: false } : block
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function restoreBlock(value: unknown): AgentBlock | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string') return null;
  if (value.kind === 'user' && typeof value.text === 'string') {
    return { kind: 'user', id: value.id, text: value.text };
  }
  if (value.kind === 'text' && typeof value.text === 'string') {
    return { kind: 'text', id: value.id, text: value.text, streaming: false };
  }
  if (value.kind === 'note' && typeof value.text === 'string'
    && (value.tone === 'error' || value.tone === 'muted')) {
    return { kind: 'note', id: value.id, text: value.text, tone: value.tone };
  }
  if (value.kind === 'stopped' && typeof value.turns === 'number') {
    return { kind: 'stopped', id: value.id, turns: value.turns };
  }
  if (value.kind === 'compacted') return { kind: 'compacted', id: value.id };
  if (value.kind === 'tool' && typeof value.tool === 'string' && isRecord(value.input)) {
    return {
      kind: 'tool',
      id: value.id,
      tool: value.tool,
      input: value.input,
      output: typeof value.output === 'string' ? value.output : '',
      result: typeof value.result === 'string' ? value.result : undefined,
      isError: typeof value.isError === 'boolean' ? value.isError : undefined,
      // A process interrupted by app shutdown must not return as permanently running.
      done: true,
    };
  }
  return null;
}

function restoreConversation(value: unknown): AgentConversation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.blocks)) return null;
  const now = Date.now();
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    blocks: value.blocks.map(restoreBlock).filter((block): block is AgentBlock => block !== null),
    busy: false,
    pending: null,
    runStartedAt: null,
    contextTokens: typeof value.contextTokens === 'number' ? value.contextTokens : 0,
    spentTokens: typeof value.spentTokens === 'number' ? value.spentTokens : 0,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
  };
}

/** Validates the local record and clears states that cannot survive a process restart. */
export function restoreConversationState(value: unknown): ConversationState | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items
    .map(restoreConversation)
    .filter((item): item is AgentConversation => item !== null);
  if (items.length === 0) return null;
  const requested = typeof value.activeId === 'string' ? value.activeId : '';
  return {
    activeId: items.some((item) => item.id === requested) ? requested : items[0].id,
    items,
  };
}

/** Keeps recent conversations and removes duplicated completed tool stream output. */
export function prepareConversationState(state: ConversationState): ConversationState {
  const newest = [...state.items]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_CONVERSATIONS);
  const items = newest.map((conversation) => ({
    ...conversation,
    busy: false,
    pending: null,
    runStartedAt: null,
    blocks: settleText(conversation.blocks).map((block) => (
      block.kind === 'tool' && block.done && block.result !== undefined
        ? { ...block, output: '' }
        : block
    )),
  }));
  return {
    activeId: items.some((item) => item.id === state.activeId) ? state.activeId : items[0].id,
    items,
  };
}

function applyAgentEvent(conversation: AgentConversation, event: AgentEvent): AgentConversation {
  switch (event.type) {
    case 'text': {
      const last = conversation.blocks[conversation.blocks.length - 1];
      const blocks: AgentBlock[] = last?.kind === 'text' && last.streaming
        ? [...conversation.blocks.slice(0, -1), { ...last, text: last.text + event.delta }]
        : [...conversation.blocks, {
          kind: 'text', id: nextBlockId(), text: event.delta, streaming: true,
        }];
      return { ...conversation, blocks };
    }
    case 'tool_start':
      return {
        ...conversation,
        blocks: [...settleText(conversation.blocks), {
          kind: 'tool',
          id: event.callId,
          tool: event.tool,
          input: event.input,
          output: '',
          done: false,
        }],
      };
    case 'tool_output':
      return {
        ...conversation,
        blocks: conversation.blocks.map((block) => (
          block.kind === 'tool' && block.id === event.callId
            ? { ...block, output: block.output + event.chunk }
            : block
        )),
      };
    case 'tool_end':
      return {
        ...conversation,
        blocks: conversation.blocks.map((block) => (
          block.kind === 'tool' && block.id === event.callId
            ? { ...block, result: event.output, isError: event.isError, done: true }
            : block
        )),
      };
    case 'approval':
      return { ...conversation, pending: event.question };
    case 'usage':
      return {
        ...conversation,
        contextTokens: event.inputTokens,
        spentTokens: conversation.spentTokens + event.inputTokens + event.outputTokens,
      };
    case 'compacted':
      return {
        ...conversation,
        blocks: [...settleText(conversation.blocks), { kind: 'compacted', id: nextBlockId() }],
      };
    case 'done': {
      const blocks = settleText(conversation.blocks);
      return {
        ...conversation,
        blocks: event.stopReason === 'max_turns'
          ? [...blocks, { kind: 'stopped', id: nextBlockId(), turns: event.turns }]
          : blocks,
        busy: false,
        pending: null,
        runStartedAt: null,
      };
    }
    case 'error':
      return {
        ...conversation,
        blocks: [...settleText(conversation.blocks), createNoteBlock(event.message, 'error')],
        busy: false,
        pending: null,
        runStartedAt: null,
      };
  }
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact;
}

export function useAgent(sessionId: string, connectionId: string, serverLabel: string) {
  const [conversationState, setConversationState] = useState<ConversationState>(() => {
    const first = createConversation();
    return { activeId: first.id, items: [first] };
  });
  const [historyReady, setHistoryReady] = useState(false);
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [localRoot, setLocalRoot] = useState<string | null>(null);
  const [needsFolder, setNeedsFolder] = useState(false);
  const conversationStateRef = useRef(conversationState);
  const historyReadyRef = useRef(historyReady);
  conversationStateRef.current = conversationState;
  historyReadyRef.current = historyReady;

  useEffect(() => {
    let cancelled = false;
    setHistoryReady(false);
    void window.electron.agentConversationsGet(connectionId)
      .then((saved) => {
        if (cancelled) return;
        const restored = restoreConversationState(saved);
        if (restored) setConversationState(restored);
      })
      .catch((error) => {
        log.error('[Agent] Could not restore conversation history', error);
      })
      .finally(() => {
        if (!cancelled) setHistoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  // Token streams can update dozens of times a second. Persist the latest snapshot in
  // one short batch instead of turning every chunk into a disk write.
  useEffect(() => {
    if (!historyReady) return;
    const timer = window.setTimeout(() => {
      void window.electron.agentConversationsSet(
        connectionId,
        prepareConversationState(conversationState),
      ).catch((error) => log.error('[Agent] Could not save conversation history', error));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [connectionId, conversationState, historyReady]);

  // Flush once more when a workspace closes so the final short update is not lost to
  // the debounce timer.
  useEffect(() => () => {
    if (!historyReadyRef.current) return;
    void window.electron.agentConversationsSet(
      connectionId,
      prepareConversationState(conversationStateRef.current),
    ).catch(() => undefined);
  }, [connectionId]);

  const active = conversationState.items.find((item) => item.id === conversationState.activeId)
    ?? conversationState.items[0];

  const updateConversation = useCallback((
    conversationId: string,
    update: (conversation: AgentConversation) => AgentConversation,
  ) => {
    setConversationState((current) => ({
      ...current,
      items: current.items.map((conversation) => (
        conversation.id === conversationId ? update(conversation) : conversation
      )),
    }));
  }, []);

  const refreshConfig = useCallback(() => {
    window.electron.agentConfigGet().then(setConfig).catch((error) => {
      log.error('[Agent] Could not read the agent settings', error);
    });
  }, []);

  useEffect(refreshConfig, [refreshConfig]);

  useEffect(() => window.electron.onAgentConfigChanged(setConfig), []);

  useEffect(() => {
    // Shell output is mirrored to the terminal, but remains routed by conversation in
    // the Agent panel so a background conversation can finish without stealing focus.
    const shellCalls = new Map<string, Set<string>>();
    return window.electron.onAgentEvent(({ sessionId: from, conversationId, event }) => {
      if (from !== sessionId) return;

      updateConversation(conversationId, (conversation) => ({
        ...applyAgentEvent(conversation, event),
        updatedAt: Date.now(),
      }));

      let calls = shellCalls.get(conversationId);
      if (!calls) {
        calls = new Set<string>();
        shellCalls.set(conversationId, calls);
      }
      if (event.type === 'tool_start' && event.tool === 'shell') {
        calls.add(event.callId);
        const command = event.input.command;
        if (typeof command === 'string') echoAgentCommand(sessionId, command);
      }
      if (event.type === 'tool_output' && calls.has(event.callId)) {
        echoAgentOutput(sessionId, event.terminalChunk ?? event.chunk);
      }
      if (event.type === 'tool_end' && calls.delete(event.callId)) {
        echoAgentResult(sessionId, event.isError);
      }
      if (event.type === 'tool_end' && event.isError
        && event.output.includes('No local folder has been shared')) {
        setNeedsFolder(true);
      }
    });
  }, [sessionId, updateConversation]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || active.busy) return;

    const conversationId = active.id;
    const startedAt = Date.now();
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.title || titleFromMessage(message),
      blocks: [...conversation.blocks, createUserBlock(message)],
      busy: true,
      runStartedAt: startedAt,
      updatedAt: startedAt,
    }));

    const result = await window.electron.agentSend({
      sessionId,
      connectionId,
      conversationId,
      serverLabel,
      message,
      localRoot,
    }).catch((error) => ({ ok: false as const, error: errorMessage(error, 'Could not start') }));

    if (!result.ok) {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        blocks: [...conversation.blocks, createNoteBlock(result.error, 'error')],
        busy: false,
        runStartedAt: null,
        updatedAt: Date.now(),
      }));
    }
  }, [active.busy, active.id, connectionId, localRoot, serverLabel, sessionId, updateConversation]);

  const answer = useCallback((callId: string, value: ApprovalAnswer) => {
    const conversationId = active.id;
    updateConversation(conversationId, (conversation) => ({ ...conversation, pending: null }));
    void window.electron.agentAnswer({ conversationId, callId, answer: value });
  }, [active.id, updateConversation]);

  const stop = useCallback(() => {
    window.electron.agentCancel(active.id);
  }, [active.id]);

  const newConversation = useCallback(() => {
    setConversationState((current) => {
      const activeConversation = current.items.find((item) => item.id === current.activeId);
      // Repeated clicks on the plus button must not accumulate placeholder sessions.
      if (activeConversation?.blocks.length === 0) return current;

      const created = createConversation();
      return {
        activeId: created.id,
        items: [...current.items, created],
      };
    });
  }, []);

  const switchConversation = useCallback((conversationId: string) => {
    setConversationState((current) => (
      current.items.some((conversation) => conversation.id === conversationId)
        ? { ...current, activeId: conversationId }
        : current
    ));
  }, []);

  const deleteConversation = useCallback((conversationId: string) => {
    const current = conversationStateRef.current;
    const next = deleteConversationFromState(current, conversationId);
    if (next === current) return;

    // Update the ref immediately so an event already queued for the removed conversation
    // cannot be flushed back to disk while React is rendering the replacement state.
    conversationStateRef.current = next;
    setConversationState(next);
    void window.electron.agentConversationDelete(
      connectionId,
      conversationId,
      prepareConversationState(next),
    ).then((deleted) => {
      if (!deleted) log.error('[Agent] Main process refused to delete conversation history');
    }).catch((error) => log.error('[Agent] Could not delete conversation history', error));
  }, [connectionId]);

  /**
   * Applied locally first because two quick settings writes can otherwise land out of
   * order and silently revert the first control when the second reply arrives.
   */
  const patchConfig = useCallback((patch: Partial<AgentConfig>) => {
    setConfig((current) => (current ? { ...current, ...patch } : current));
    void window.electron.agentConfigSet(patch).catch((error) => {
      log.error('[Agent] Could not save the agent settings', error);
      refreshConfig();
    });
  }, [refreshConfig]);

  const setMode = useCallback((mode: AgentMode) => patchConfig({ mode }), [patchConfig]);
  const setModel = useCallback((model: string) => patchConfig({ model }), [patchConfig]);
  const setEffort = useCallback((effort: ReasoningEffort) => patchConfig({ effort }), [patchConfig]);

  const shareFolder = useCallback(async () => {
    const picked = await window.electron.agentPickFolder().catch(() => null);
    if (!picked) return;
    setLocalRoot(picked);
    setNeedsFolder(false);
  }, []);

  const conversations = useMemo<AgentConversationSummary[]>(() => (
    conversationState.items.map(({ id, title, busy, createdAt, updatedAt }) => ({
      id, title, busy, createdAt, updatedAt,
    }))
  ), [conversationState.items]);

  return {
    blocks: active.blocks,
    busy: active.busy,
    runStartedAt: active.runStartedAt,
    pending: active.pending,
    contextTokens: active.contextTokens,
    spentTokens: active.spentTokens,
    activeConversationId: active.id,
    conversations,
    config,
    localRoot,
    needsFolder,
    send,
    answer,
    stop,
    newConversation,
    switchConversation,
    deleteConversation,
    refreshConfig,
    setEffort,
    setMode,
    setModel,
    shareFolder,
    clearFolder: useCallback(() => setLocalRoot(null), []),
  };
}

/** The controller is held at workspace level so its sessions survive panel tab switches. */
export type AgentController = ReturnType<typeof useAgent>;
