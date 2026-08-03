import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { log } from '../lib/logger';
import type {
  AgentConfigView,
  AgentEvent,
  ApprovalAnswer,
  ApprovalQuestion,
} from '../shared/agent';

/**
 * The conversation as a flat stream of blocks rather than nested turns.
 *
 * One message produces text, then tool calls, then more text, then more calls — the model
 * alternates for as long as the task takes. A flat list renders that in arrival order
 * without having to decide where one "turn" ends.
 */
export type AgentBlock =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'note'; id: string; text: string; tone: 'error' | 'muted' }
  /** The loop gave up rather than finished; the panel translates the count itself. */
  | { kind: 'stopped'; id: string; turns: number }
  | {
    kind: 'tool';
    id: string;
    tool: string;
    input: Record<string, unknown>;
    /** Streams while the tool runs. */
    output: string;
    result?: string;
    isError?: boolean;
    done: boolean;
  };

let sequence = 0;
const nextId = () => `b${++sequence}`;

export function useAgent(sessionId: string, serverLabel: string) {
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ApprovalQuestion | null>(null);
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [localRoot, setLocalRoot] = useState<string | null>(null);

  // Read once per mount and refreshed after the settings page writes, so the panel knows
  // whether a key exists without ever being able to read it.
  const refreshConfig = useCallback(() => {
    window.electron.agentConfigGet().then(setConfig).catch((error) => {
      log.error('[Agent] Could not read the agent settings', error);
    });
  }, []);

  useEffect(refreshConfig, [refreshConfig]);

  const append = useCallback((block: AgentBlock) => {
    setBlocks((current) => [...current, block]);
  }, []);

  useEffect(() => window.electron.onAgentEvent(({ sessionId: from, event }) => {
    if (from !== sessionId) return;
    apply(event, setBlocks, setPending, setBusy);
  }), [sessionId]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;

    append({ kind: 'user', id: nextId(), text: message });
    setBusy(true);

    const result = await window.electron
      .agentSend({ sessionId, serverLabel, message, localRoot })
      .catch((error) => ({ ok: false as const, error: errorMessage(error, 'Could not start') }));

    if (!result.ok) {
      append({ kind: 'note', id: nextId(), text: result.error, tone: 'error' });
      setBusy(false);
    }
  }, [append, busy, localRoot, serverLabel, sessionId]);

  const answer = useCallback((callId: string, value: ApprovalAnswer) => {
    setPending(null);
    void window.electron.agentAnswer({ sessionId, callId, answer: value });
  }, [sessionId]);

  const stop = useCallback(() => {
    window.electron.agentCancel(sessionId);
  }, [sessionId]);

  const reset = useCallback(() => {
    window.electron.agentCancel(sessionId);
    void window.electron.agentReset(sessionId);
    setBlocks([]);
    setPending(null);
    setBusy(false);
  }, [sessionId]);

  const shareFolder = useCallback(async () => {
    const picked = await window.electron.agentPickFolder().catch(() => null);
    if (picked) setLocalRoot(picked);
  }, []);

  return {
    blocks,
    busy,
    pending,
    config,
    localRoot,
    send,
    answer,
    stop,
    reset,
    refreshConfig,
    shareFolder,
    clearFolder: useCallback(() => setLocalRoot(null), []),
  };
}

type BlockSetter = React.Dispatch<React.SetStateAction<AgentBlock[]>>;

function apply(
  event: AgentEvent,
  setBlocks: BlockSetter,
  setPending: React.Dispatch<React.SetStateAction<ApprovalQuestion | null>>,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
) {
  switch (event.type) {
    case 'text':
      // Appended to the trailing text block, or started as a new one when the last thing
      // that happened was a tool call.
      setBlocks((current) => {
        const last = current[current.length - 1];
        if (last?.kind === 'text') {
          return [...current.slice(0, -1), { ...last, text: last.text + event.delta }];
        }
        return [...current, { kind: 'text', id: nextId(), text: event.delta }];
      });
      return;

    case 'tool_start':
      setBlocks((current) => [...current, {
        kind: 'tool',
        id: event.callId,
        tool: event.tool,
        input: event.input,
        output: '',
        done: false,
      }]);
      return;

    case 'tool_output':
      setBlocks((current) => current.map((block) => (
        block.kind === 'tool' && block.id === event.callId
          ? { ...block, output: block.output + event.chunk }
          : block
      )));
      return;

    case 'tool_end':
      setBlocks((current) => current.map((block) => (
        block.kind === 'tool' && block.id === event.callId
          ? { ...block, result: event.output, isError: event.isError, done: true }
          : block
      )));
      return;

    case 'approval':
      setPending(event.question);
      return;

    case 'done':
      setBusy(false);
      if (event.stopReason === 'max_turns') {
        setBlocks((current) => [...current, { kind: 'stopped', id: nextId(), turns: event.turns }]);
      }
      return;

    case 'error':
      setBusy(false);
      setBlocks((current) => [...current, {
        kind: 'note', id: nextId(), tone: 'error', text: event.message,
      }]);
      return;

    default:
      // `usage` is carried for later; nothing on screen reads it yet.
  }
}
