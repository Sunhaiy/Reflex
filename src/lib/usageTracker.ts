import type { UsageDelta } from '../shared/types';

const SUM_FIELDS = [
  'appOpens',
  'successfulConnections',
  'serverOperations',
  'mouseClicks',
  'keyboardPresses',
  'terminalInputCharacters',
  'totalConnectedMs',
  'tokenUsage',
  'activity',
] as const;

let pending: UsageDelta = {};
let flushTimer: number | null = null;
let appOpenRecorded = false;

export function flushUsage() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (Object.keys(pending).length === 0) return;
  const delta = pending;
  pending = {};
  window.electron.usageRecord(delta);
}

export function queueUsage(delta: UsageDelta) {
  for (const field of SUM_FIELDS) {
    const value = delta[field];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      pending[field] = (pending[field] || 0) + value;
    }
  }
  if (typeof delta.longestConnectionMs === 'number' && delta.longestConnectionMs > 0) {
    pending.longestConnectionMs = Math.max(pending.longestConnectionMs || 0, delta.longestConnectionMs);
  }
  if (flushTimer === null) flushTimer = window.setTimeout(flushUsage, 1600);
}

export function startUsageTracking() {
  const handlePointer = () => queueUsage({ mouseClicks: 1, activity: 1 });
  const handleKeyboard = () => queueUsage({ keyboardPresses: 1, activity: 1 });
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') flushUsage();
  };

  document.addEventListener('pointerdown', handlePointer, { capture: true });
  document.addEventListener('keydown', handleKeyboard, { capture: true });
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', flushUsage);
  if (!appOpenRecorded) {
    appOpenRecorded = true;
    queueUsage({ appOpens: 1, activity: 1 });
  }

  return () => {
    document.removeEventListener('pointerdown', handlePointer, { capture: true });
    document.removeEventListener('keydown', handleKeyboard, { capture: true });
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', flushUsage);
    flushUsage();
  };
}
