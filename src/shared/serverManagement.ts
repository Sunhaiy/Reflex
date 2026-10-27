import type { SSHConnection, Session, SessionStatus } from './types';

export interface Category {
  id: string;
  name: string;
}
export interface ServerCatalog {
  groups: Category[];
  tags: Category[];
}
export interface ReminderSettings {
  enabled: boolean;
  days: number[];
}
export interface Renewal {
  dueDate?: string;
  cycle: 0 | 1 | 3 | 6 | 12;
  amount?: number;
  currency: string;
  reminder?: 'inherit' | 'off' | 'custom';
  days?: number[];
}
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, days: [30, 7, 3, 1, 0] };
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 9999) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.getTime() / 86400000;
}
export function daysRemaining(dueDate?: string, today = localDate()): number | null {
  const due = dayNumber(dueDate ?? '');
  const current = dayNumber(today);
  return due === null || current === null ? null : due - current;
}
export function nextDueDate(dueDate: string | undefined, months: number): string {
  if (!dueDate || daysRemaining(dueDate) === null || !months) return dueDate ?? '';
  const [y, m, d] = dueDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export function parseReminderDays(text: string): number[] | null {
  if (!text.trim()) return null;
  const values = text.split(/[,，\s]+/).filter(Boolean);
  if (values.some((v) => !/^\d+$/.test(v) || Number(v) > 3650)) return null;
  return [...new Set(values.map(Number))].sort((a, b) => b - a);
}
export function renewalValid(value: Renewal): boolean {
  return (
    (!value.dueDate || daysRemaining(value.dueDate) !== null) &&
    [0, 1, 3, 6, 12].includes(value.cycle) &&
    (value.amount === undefined || (Number.isFinite(value.amount) && value.amount >= 0)) &&
    /^[A-Z]{3}$/.test(value.currency) &&
    (value.reminder !== 'custom' ||
      Boolean(value.days?.length && value.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 3650)))
  );
}
export function aggregateStatus(sessions: Session[], id: string): SessionStatus | undefined {
  const matches = sessions.filter((s) => s.connection.id === id);
  return matches.some((s) => s.status === 'connected')
    ? 'connected'
    : matches.some((s) => s.status === 'connecting')
      ? 'connecting'
      : matches.length
        ? 'disconnected'
        : undefined;
}
export interface ServerFilters {
  query: string;
  group: string;
  tags: string[];
  status: string;
  due: string;
  sort: 'recent' | 'name' | 'due';
}
export function filterServers(
  connections: SSHConnection[],
  sessions: Session[],
  catalog: ServerCatalog,
  filters: ServerFilters,
  recent: Record<string, number>,
  today = localDate(),
) {
  const needle = filters.query.trim().toLocaleLowerCase();
  return connections
    .filter((c) => {
      const group = catalog.groups.find((g) => g.id === c.groupId);
      const tags = catalog.tags.filter((t) => c.tagIds?.includes(t.id));
      const days = daysRemaining(c.renewal?.dueDate, today);
      return (
        (!needle ||
          [c.name, c.host, c.username, c.providerUrl, group?.name, ...tags.map((t) => t.name)].some((v) =>
            v?.toLocaleLowerCase().includes(needle),
          )) &&
        (!filters.group || (filters.group === 'ungrouped' ? !group : c.groupId === filters.group)) &&
        (!filters.tags.length || filters.tags.some((t) => c.tagIds?.includes(t))) &&
        (!filters.status || (aggregateStatus(sessions, c.id) ?? 'idle') === filters.status) &&
        (!filters.due ||
          (filters.due === 'upcoming'
            ? days !== null && days >= 0 && days <= 30
            : filters.due === 'overdue'
              ? days !== null && days < 0
              : filters.due === 'attention'
                ? days !== null && days <= 30
                : days === null))
      );
    })
    .sort((a, b) => {
      if (filters.sort === 'due') {
        const ad = daysRemaining(a.renewal?.dueDate, today),
          bd = daysRemaining(b.renewal?.dueDate, today);
        if (ad !== bd) return ad === null ? 1 : bd === null ? -1 : ad - bd;
      }
      if (filters.sort === 'recent' && recent[a.id] !== recent[b.id]) return (recent[b.id] ?? 0) - (recent[a.id] ?? 0);
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}
export interface ReminderLedger {
  lastDate?: string;
  seen: Record<string, number>;
}
export function reminderCandidates(
  connections: SSHConnection[],
  settings: ReminderSettings,
  ledger: ReminderLedger,
  today = localDate(),
) {
  if (!settings.enabled || ledger.lastDate === today) return [];
  return connections.filter((c) => {
    const r = c.renewal;
    if (!r?.dueDate || r.reminder === 'off') return false;
    const days = daysRemaining(r.dueDate, today);
    const nodes = r.reminder === 'custom' ? (r.days ?? []) : settings.days;
    if (days === null || !nodes.length) return false;
    if (days < 0) return true;
    const crossed = nodes.filter((n) => days <= n);
    const previous = ledger.seen[`${c.id}:${r.dueDate}`];
    return crossed.length > 0 && (previous === undefined || crossed.some((n) => previous > n));
  });
}
