import { describe, expect, it } from 'vitest';
import { createEmptyUsageStats, mergeUsageDelta, normalizeUsageStats } from '../usage';

describe('normalizeUsageStats', () => {
  it('returns a complete record from nothing', () => {
    const stats = normalizeUsageStats(undefined, 1_000);
    expect(stats.firstUsedAt).toBe(1_000);
    expect(stats.appOpens).toBe(0);
    expect(stats.activityByDay).toEqual({});
  });

  it('discards day keys that are not dates, and days with no activity', () => {
    const stats = normalizeUsageStats({
      activityByDay: { '2026-08-01': 5, 'not-a-date': 9, '2026-08-02': 0 },
    });
    expect(stats.activityByDay).toEqual({ '2026-08-01': 5 });
  });

  it('refuses negative and non-numeric counters', () => {
    const stats = normalizeUsageStats({ appOpens: -4, mouseClicks: 'lots' as unknown as number });
    expect(stats.appOpens).toBe(0);
    expect(stats.mouseClicks).toBe(0);
  });
});

describe('mergeUsageDelta', () => {
  it('adds counters and records the day', () => {
    const now = Date.parse('2026-08-01T12:00:00');
    const merged = mergeUsageDelta(createEmptyUsageStats(now), { appOpens: 1, activity: 3 }, now);
    expect(merged.appOpens).toBe(1);
    expect(Object.values(merged.activityByDay)).toEqual([3]);
  });

  it('keeps the longest session rather than summing it', () => {
    const base = mergeUsageDelta(undefined, { longestConnectionMs: 5_000 });
    const next = mergeUsageDelta(base, { longestConnectionMs: 2_000 });
    expect(next.longestConnectionMs).toBe(5_000);
  });

  it('drops day buckets older than the retention window', () => {
    const now = Date.parse('2026-08-01T12:00:00');
    const stale = { ...createEmptyUsageStats(now), activityByDay: { '2020-01-01': 12 } };
    const merged = mergeUsageDelta(stale, { activity: 1 }, now);
    expect(merged.activityByDay['2020-01-01']).toBeUndefined();
  });
});
