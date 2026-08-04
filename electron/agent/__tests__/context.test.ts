import { describe, expect, it } from 'vitest';
import { compactHistory, estimateTokens, foldOldest, SUMMARY_MARKER, transcribe } from '../context';
import type { Message } from '../providers/types';

function conversation(resultCount: number, resultChars: number): Message[] {
  const messages: Message[] = [
    { role: 'user', parts: [{ type: 'text', text: 'deploy the blog' }] },
  ];
  for (let index = 0; index < resultCount; index += 1) {
    messages.push({
      role: 'assistant',
      parts: [
        { type: 'text', text: `step ${index}` },
        { type: 'tool_call', id: `c${index}`, name: 'shell', input: { command: `echo ${index}` } },
      ],
    });
    messages.push({
      role: 'tool',
      parts: [{ type: 'tool_result', id: `c${index}`, content: 'x'.repeat(resultChars) }],
    });
  }
  return messages;
}

function resultContents(messages: Message[]): string[] {
  return messages.flatMap((message) => message.parts
    .filter((part): part is Extract<typeof part, { type: 'tool_result' }> => part.type === 'tool_result')
    .map((part) => part.content));
}

describe('compactHistory', () => {
  it('leaves a short conversation exactly as it is', () => {
    const messages = conversation(3, 200);
    expect(compactHistory(messages, { maxTokens: 60_000 })).toBe(messages);
  });

  it('drops the oldest output once the history is too long', () => {
    // 30 results of 8k characters is 60k tokens; keeping the last five fits in 20k.
    const compacted = compactHistory(conversation(30, 8_000), { maxTokens: 20_000, keepRecentResults: 5 });
    const contents = resultContents(compacted);

    expect(contents).toHaveLength(30);
    expect(contents.slice(0, 25).every((text) => text.startsWith('[output dropped'))).toBe(true);
    expect(contents.slice(-5).every((text) => text === 'x'.repeat(8_000))).toBe(true);
  });

  it('says how much was dropped so the model knows it can ask again', () => {
    const messages = conversation(20, 30_000);
    messages[2].parts = [{ type: 'tool_result', id: 'c0', content: 'a\nb\nc\nd' }];
    const dropped = resultContents(compactHistory(messages, { maxTokens: 1_000 }))[0];

    expect(dropped).toContain('4 lines');
    expect(dropped).toContain('Re-run');
  });

  it('never touches the reasoning or the commands', () => {
    // What the model needs late in a deployment is its own plan and what it just ran.
    const compacted = compactHistory(conversation(30, 40_000), { maxTokens: 1_000 });

    const texts = compacted.flatMap((message) => message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text));
    expect(texts).toContain('deploy the blog');
    expect(texts).toContain('step 29');

    const calls = compacted.flatMap((message) => message.parts.filter((part) => part.type === 'tool_call'));
    expect(calls).toHaveLength(30);
  });

  it('keeps the shape of the transcript', () => {
    const messages = conversation(30, 40_000);
    const compacted = compactHistory(messages, { maxTokens: 1_000 });

    expect(compacted).toHaveLength(messages.length);
    expect(compacted.map((message) => message.role)).toEqual(messages.map((message) => message.role));
  });

  it('stops trimming rather than leaving the model with nothing recent', () => {
    // Even a budget nothing can satisfy must leave the last couple of results intact.
    const compacted = compactHistory(conversation(30, 40_000), { maxTokens: 1 });
    const kept = resultContents(compacted).filter((text) => !text.startsWith('[output dropped'));
    expect(kept).toHaveLength(2);
  });

  it('gives up room one step at a time', () => {
    // A history that only just overflows should lose as little output as it can.
    const messages = conversation(12, 4_000);
    const total = estimateTokens(messages);
    const kept = resultContents(compactHistory(messages, { maxTokens: total - 1_500, keepRecentResults: 8 }))
      .filter((text) => !text.startsWith('[output dropped'));

    expect(kept.length).toBeGreaterThan(2);
    expect(kept.length).toBeLessThan(12);
  });
});

describe('estimateTokens', () => {
  it('counts text, tool calls and results', () => {
    const messages: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: 'x'.repeat(400) }] },
      { role: 'tool', parts: [{ type: 'tool_result', id: 'c0', content: 'y'.repeat(400) }] },
    ];
    expect(estimateTokens(messages)).toBe(200);
  });

  it('is zero for an empty conversation', () => {
    expect(estimateTokens([])).toBe(0);
  });
});

describe('foldOldest', () => {
  const summarise = async (transcript: string) => `summary of ${transcript.split('\n').length} lines`;

  it('leaves a short conversation alone — there is nothing worth folding', async () => {
    const messages = conversation(1, 100);
    expect(await foldOldest(messages, summarise)).toBe(messages);
  });

  it('keeps the opening message verbatim', async () => {
    // It is the task. A summary of the goal is the one thing that must not drift.
    const folded = await foldOldest(conversation(10, 100), summarise);
    expect(folded[0]).toEqual({ role: 'user', parts: [{ type: 'text', text: 'deploy the blog' }] });
  });

  it('replaces the older half with one marked summary', async () => {
    const folded = await foldOldest(conversation(10, 100), summarise);
    const second = folded[1];

    expect(second.role).toBe('user');
    expect(second.parts[0]).toMatchObject({ type: 'text' });
    expect((second.parts[0] as { text: string }).text).toContain(SUMMARY_MARKER);
    expect(folded.length).toBeLessThan(conversation(10, 100).length);
  });

  it('never leaves a tool result answering a call that was folded away', async () => {
    // A tool turn opening the kept history would reference tool_use ids that no longer
    // exist, which every provider rejects.
    const folded = await foldOldest(conversation(10, 100), summarise);
    expect(folded.slice(2).findIndex((message) => message.role === 'tool')).not.toBe(0);
  });

  it('keeps the conversation as it was when the summary comes back empty', async () => {
    const messages = conversation(10, 100);
    expect(await foldOldest(messages, async () => '   ')).toBe(messages);
  });
});

describe('transcribe', () => {
  it('renders text, calls and results as readable lines', () => {
    const text = transcribe([
      { role: 'assistant', parts: [
        { type: 'text', text: 'checking docker' },
        { type: 'tool_call', id: 'c1', name: 'shell', input: { command: 'docker ps' } },
      ] },
      { role: 'tool', parts: [{ type: 'tool_result', id: 'c1', content: 'no containers', isError: false }] },
    ]);

    expect(text).toContain('assistant: checking docker');
    expect(text).toContain('called shell');
    expect(text).toContain('result: no containers');
  });

  it('marks a failed result as failed', () => {
    const text = transcribe([
      { role: 'tool', parts: [{ type: 'tool_result', id: 'c1', content: 'boom', isError: true }] },
    ]);
    expect(text).toContain('result (failed): boom');
  });
});
