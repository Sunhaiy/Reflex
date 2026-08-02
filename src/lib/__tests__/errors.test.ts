import { describe, expect, it } from 'vitest';
import { errorMessage } from '../errors';

describe('errorMessage', () => {
  it('reads the message off an Error', () => {
    expect(errorMessage(new Error('connection refused'))).toBe('connection refused');
  });

  it('accepts a thrown string', () => {
    expect(errorMessage('timed out')).toBe('timed out');
  });

  // IPC rejections arrive as plain objects, not Error instances — which is why the
  // call sites used to reach for `.message` on an `any`.
  it('accepts anything shaped like an error', () => {
    expect(errorMessage({ message: 'Unsupported settings key' })).toBe('Unsupported settings key');
  });

  it.each([[null], [undefined], [{}], [42], [new Error('')], [''], [{ message: 123 }]])(
    'falls back for %j',
    (thrown) => {
      expect(errorMessage(thrown, 'fallback')).toBe('fallback');
    },
  );

  it('returns an empty string when no fallback is given', () => {
    expect(errorMessage(null)).toBe('');
  });
});
