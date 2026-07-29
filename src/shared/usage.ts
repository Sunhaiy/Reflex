import type { UsageDelta, UsageStats } from './types';

const ADDITIVE_FIELDS = [
  'appOpens',
  'successfulConnections',
  'serverOperations',
  'mouseClicks',
  'keyboardPresses',
  'terminalInputCharacters',
  'totalConnectedMs',
  'tokenUsage',
] as const;

function safeCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createEmptyUsageStats(now = Date.now()): UsageStats {
  return {
    version: 1,
    firstUsedAt: now,
    lastActiveAt: now,
    appOpens: 0,
    successfulConnections: 0,
    serverOperations: 0,
    mouseClicks: 0,
    keyboardPresses: 0,
    terminalInputCharacters: 0,
    totalConnectedMs: 0,
    longestConnectionMs: 0,
    tokenUsage: 0,
    activityByDay: {},
  };
}

export function normalizeUsageStats(value: unknown, now = Date.now()): UsageStats {
  const source = value && typeof value === 'object' ? value as Partial<UsageStats> : {};
  const normalized = createEmptyUsageStats(now);

  normalized.firstUsedAt = safeCount(source.firstUsedAt) || now;
  normalized.lastActiveAt = safeCount(source.lastActiveAt) || normalized.firstUsedAt;
  for (const field of ADDITIVE_FIELDS) normalized[field] = safeCount(source[field]);
  normalized.longestConnectionMs = safeCount(source.longestConnectionMs);

  if (source.activityByDay && typeof source.activityByDay === 'object') {
    normalized.activityByDay = Object.fromEntries(
      Object.entries(source.activityByDay)
        .filter(([key, count]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && safeCount(count) > 0)
        .map(([key, count]) => [key, safeCount(count)]),
    );
  }

  return normalized;
}

export function mergeUsageDelta(current: unknown, delta: UsageDelta, now = Date.now()): UsageStats {
  const next = normalizeUsageStats(current, now);
  let totalIncrement = 0;

  for (const field of ADDITIVE_FIELDS) {
    const increment = safeCount(delta[field]);
    next[field] += increment;
    totalIncrement += increment;
  }

  next.longestConnectionMs = Math.max(next.longestConnectionMs, safeCount(delta.longestConnectionMs));
  const activity = safeCount(delta.activity) || Math.min(totalIncrement, 250);
  if (activity > 0) {
    const key = localDayKey(new Date(now));
    next.activityByDay[key] = (next.activityByDay[key] || 0) + activity;
    next.lastActiveAt = now;
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 400);
  const cutoffKey = localDayKey(cutoff);
  next.activityByDay = Object.fromEntries(
    Object.entries(next.activityByDay).filter(([key]) => key >= cutoffKey),
  );

  return next;
}
