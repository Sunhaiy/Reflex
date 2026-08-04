import type { Message, MessagePart } from './providers/types';

/**
 * How much history to carry before old tool output starts getting dropped.
 *
 * Deliberately below the smallest context window the agent might be pointed at rather
 * than tuned to the largest: the user picks the model, and a run that dies of a
 * context-length error twenty commands into a deployment is the worst possible failure —
 * it happens late, it wastes everything spent so far, and the recovery is to start over.
 */
const DEFAULT_MAX_TOKENS = 60_000;

/** Tool results kept in full. Everything older keeps its command but loses its output. */
const DEFAULT_KEEP_RECENT = 8;

/** Below this the run has no working memory left, so trimming stops here even if over. */
const MIN_KEEP_RECENT = 2;

/**
 * Four characters per token is wrong in the third decimal place and right enough to
 * decide when to trim. Counting properly would mean a round trip per turn to an endpoint
 * that may not implement it.
 */
export function estimateTokens(messages: Message[]): number {
  let characters = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text') characters += part.text.length;
      if (part.type === 'tool_result') characters += part.content.length;
      if (part.type === 'tool_call') characters += JSON.stringify(part.input).length;
    }
  }
  return Math.ceil(characters / 4);
}

function stub(part: Extract<MessagePart, { type: 'tool_result' }>): MessagePart {
  const lines = part.content.split('\n').length;
  return {
    ...part,
    content: `[output dropped to make room — ${lines} lines. Re-run the command if you need it again.]`,
  };
}

/**
 * Drops the bodies of old tool results when the history grows too long.
 *
 * What the model needs late in a deployment is the plan, its own reasoning, and the last
 * few things it saw — not the five thousand lines an install printed twenty turns ago.
 * So text and tool calls are never touched and the transcript keeps its shape; only the
 * output of older results is replaced, and the note says so, so the model knows it can
 * ask again rather than concluding the command produced nothing.
 */
export function compactHistory(
  messages: Message[],
  options: { maxTokens?: number; keepRecentResults?: number } = {},
): Message[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (estimateTokens(messages) <= maxTokens) return messages;

  // Every tool result in order, so "the last N" can be identified across messages.
  const resultPositions: Array<[number, number]> = [];
  messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (part.type === 'tool_result') resultPositions.push([messageIndex, partIndex]);
    });
  });

  let keep = options.keepRecentResults ?? DEFAULT_KEEP_RECENT;
  let compacted = messages;

  // Tightened one step at a time rather than all at once, so a history that only just
  // overflows keeps as much real output as it can.
  while (keep >= MIN_KEEP_RECENT) {
    const drop = new Set(
      resultPositions.slice(0, Math.max(0, resultPositions.length - keep))
        .map(([messageIndex, partIndex]) => `${messageIndex}:${partIndex}`),
    );

    compacted = messages.map((message, messageIndex) => ({
      ...message,
      parts: message.parts.map((part, partIndex) => (
        part.type === 'tool_result' && drop.has(`${messageIndex}:${partIndex}`)
          ? stub(part)
          : part
      )),
    }));

    if (estimateTokens(compacted) <= maxTokens) return compacted;
    keep -= 1;
  }

  return compacted;
}
