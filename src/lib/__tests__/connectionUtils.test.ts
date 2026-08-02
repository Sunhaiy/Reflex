import { describe, expect, it, vi } from 'vitest';
import {
  connectionTransportChanged,
  normalizeConnection,
  retryDelay,
} from '../connectionUtils';
import type { SSHConnection } from '../../shared/types';

const base: SSHConnection = {
  id: 'a',
  name: 'web',
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password',
  password: 'secret',
};

describe('retryDelay', () => {
  it('widens with each attempt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(2)).toBe(2000);
    expect(retryDelay(3)).toBe(4000);
    vi.restoreAllMocks();
  });

  // The jitter is the point: a fixed cadence keeps arriving at the same instant, which
  // is what a host enforcing MaxStartups rejects.
  it('stays within +/-25% of the backoff', () => {
    for (const attempt of [1, 2, 3]) {
      const backoff = 1000 * 2 ** (attempt - 1);
      for (let i = 0; i < 50; i += 1) {
        const delay = retryDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(backoff * 0.75);
        expect(delay).toBeLessThanOrEqual(backoff * 1.25);
      }
    }
  });

  it('does not always return the same value', () => {
    const seen = new Set(Array.from({ length: 40 }, () => retryDelay(2)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('normalizeConnection', () => {
  it('defaults the username to root', () => {
    expect(normalizeConnection({ ...base, username: '' }).username).toBe('root');
  });

  it('names an unnamed connection after its address', () => {
    expect(normalizeConnection({ ...base, name: '' }).name).toBe('root@10.0.0.1');
  });

  it('falls back when there is no host to name it after', () => {
    expect(normalizeConnection({ ...base, name: '', host: '' }).name).toBe('New Server');
  });

  it('keeps an id it already has and mints one otherwise', () => {
    expect(normalizeConnection(base).id).toBe('a');
    expect(normalizeConnection({ ...base, id: '' }).id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('connectionTransportChanged', () => {
  // Renaming should not drop a live shell; changing where it connects has to.
  it.each(['name', 'providerUrl'] as const)('ignores %s', (field) => {
    expect(connectionTransportChanged(base, { ...base, [field]: 'different' })).toBe(false);
  });

  it.each(['host', 'port', 'username', 'authType', 'password', 'privateKeyPath', 'passphrase'] as const)(
    'reports %s',
    (field) => {
      const changed = { ...base, [field]: field === 'port' ? 2222 : 'different' } as SSHConnection;
      expect(connectionTransportChanged(base, changed)).toBe(true);
    },
  );

  it('reports no change for an identical record', () => {
    expect(connectionTransportChanged(base, { ...base })).toBe(false);
  });
});
