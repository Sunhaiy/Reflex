import { describe, expect, it } from 'vitest';
import { normalizeTimezone, splitTimezone } from '../timezone';

describe('normalizeTimezone', () => {
  it('accepts zones that name a real place', () => {
    for (const zone of [
      'Asia/Shanghai',
      'America/Los_Angeles',
      'Europe/Berlin',
      'America/Argentina/Salta',
      'Pacific/Auckland',
      'Africa/Cairo',
    ]) {
      expect(normalizeTimezone(zone)).toBe(zone);
    }
  });

  // Every one of these was reported by a real host and each carries no location. The
  // first two shipped as bugs: they satisfy a naive Area/City check and surfaced as the
  // cities "UTC" and "a".
  it.each([
    ['Etc/UTC', 'unset on a systemd host'],
    ['n/a', 'timedatectl with nothing configured'],
    ['UTC', 'plain UTC'],
    ['Etc/GMT+8', 'a fixed offset, not a place'],
    ['', 'no output at all'],
    [undefined, 'the section missing entirely'],
  ])('rejects %j (%s)', (input, _why) => {
    expect(normalizeTimezone(input as string | undefined)).toBe('');
  });

  it('takes only the first line and trims it', () => {
    expect(normalizeTimezone('  Asia/Tokyo \nextra output')).toBe('Asia/Tokyo');
  });
});

describe('splitTimezone', () => {
  it('separates region from city and unescapes underscores', () => {
    expect(splitTimezone('America/Los_Angeles')).toEqual({ region: 'America', city: 'Los Angeles' });
  });

  it('uses the last segment for nested zones', () => {
    expect(splitTimezone('America/Argentina/Salta')).toEqual({ region: 'America', city: 'Salta' });
  });
});
