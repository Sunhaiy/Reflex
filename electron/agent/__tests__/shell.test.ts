import { describe, expect, it } from 'vitest';
import { clampOutput, consumeFrame, shellQuote } from '../shell';

const SENTINEL = '__RFX_a1b2c3d4e5f60718_7__';

/** Feeds the parser one chunk at a time, the way the channel actually delivers them. */
function stream(chunks: string[]) {
  let buffer = '';
  let visible = '';
  let exitCode: number | null | undefined;

  for (const chunk of chunks) {
    const frame = consumeFrame(buffer + chunk, SENTINEL);
    visible += frame.visible;
    buffer = frame.rest;
    if (frame.exitCode !== undefined) exitCode = frame.exitCode;
  }
  return { visible, held: buffer, exitCode };
}

describe('consumeFrame', () => {
  it('releases whole lines as soon as they arrive', () => {
    const { visible, held, exitCode } = stream(['hello\nworld\n']);
    expect(visible).toBe('hello\nworld\n');
    expect(held).toBe('');
    expect(exitCode).toBeUndefined();
  });

  it('holds back an unfinished line but not the finished ones', () => {
    // Without this, a command that prints a line and then works for a minute would stay
    // invisible for that whole minute.
    const { visible, held } = stream(['done\npartial']);
    expect(visible).toBe('done\n');
    expect(held).toBe('partial');
  });

  it('releases a long unbroken line rather than holding it forever', () => {
    const line = 'x'.repeat(500);
    const { visible, held } = stream([line]);
    expect(visible.length).toBe(500 - (SENTINEL.length + 16));
    expect(held.length).toBe(SENTINEL.length + 16);
    expect(visible + held).toBe(line);
  });

  it('reports the exit code once the marker line is whole', () => {
    const { visible, held, exitCode } = stream([`output\n${SENTINEL}:0\n`]);
    expect(visible).toBe('output\n');
    expect(held).toBe('');
    expect(exitCode).toBe(0);
  });

  it('carries a non-zero exit code through as a value, not an error', () => {
    expect(stream([`boom\n${SENTINEL}:127\n`]).exitCode).toBe(127);
  });

  it('waits when the marker has arrived but its exit code has not', () => {
    // One read ends mid-marker-line; nothing may be reported yet.
    const first = consumeFrame(`output\n${SENTINEL}:1`, SENTINEL);
    expect(first.visible).toBe('output\n');
    expect(first.exitCode).toBeUndefined();

    const second = consumeFrame(`${first.rest}2\n`, SENTINEL);
    expect(second.exitCode).toBe(12);
  });

  it('reassembles a marker split across two reads', () => {
    const half = Math.floor(SENTINEL.length / 2);
    const { visible, exitCode } = stream([
      `working\n${SENTINEL.slice(0, half)}`,
      `${SENTINEL.slice(half)}:0\n`,
    ]);
    expect(visible).toBe('working\n');
    expect(exitCode).toBe(0);
  });

  it('never emits the marker itself', () => {
    const { visible, held } = stream([`a\n${SENTINEL}:0\n`]);
    expect(visible).not.toContain('__RFX_');
    expect(held).not.toContain('__RFX_');
  });

  it('keeps anything printed after the marker line for the next command', () => {
    const { held } = stream([`a\n${SENTINEL}:0\nstray`]);
    expect(held).toBe('stray');
  });

  it('reports a null exit code when the marker carries something unparseable', () => {
    expect(stream([`a\n${SENTINEL}:\n`]).exitCode).toBeNull();
  });
});

describe('clampOutput', () => {
  it('leaves a short output alone', () => {
    const text = 'line one\nline two';
    expect(clampOutput(text)).toEqual({ text, truncated: false });
  });

  it('keeps both ends of a long output and elides the middle', () => {
    // The model needs the invocation at the top and the error at the bottom; the 4700
    // lines between them are what would crowd out the rest of the conversation.
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const { text, truncated } = clampOutput(lines.join('\n'));

    expect(truncated).toBe(true);
    expect(text).toContain('line 0');
    expect(text).toContain('line 4999');
    expect(text).toContain('4700 lines elided');
    expect(text).not.toContain('line 2500');
    expect(text.split('\n')).toHaveLength(301);
  });

  it('does not elide a listing that sits exactly on the limit', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    expect(clampOutput(lines.join('\n')).truncated).toBe(false);
  });
});

describe('shellQuote', () => {
  it('quotes an ordinary path', () => {
    expect(shellQuote('/var/www/app')).toBe(`'/var/www/app'`);
  });

  it('survives a path containing a single quote', () => {
    expect(shellQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`);
  });

  it('quotes characters the shell would otherwise expand', () => {
    expect(shellQuote('/tmp/$HOME `id` *')).toBe(`'/tmp/$HOME \`id\` *'`);
  });
});
