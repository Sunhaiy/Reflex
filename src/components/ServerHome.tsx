import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  Add01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  CommandLineIcon,
  Delete02Icon,
  FireIcon,
  KeyboardIcon,
  Key02Icon,
  Mouse01Icon,
  PencilIcon,
  Search01Icon,
  ServerStack01Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import type { SSHConnection, UsageStats } from '../shared/types';
import { createEmptyUsageStats, localDayKey, normalizeUsageStats } from '../shared/usage';

interface HomeSession {
  uniqueId: string;
  connection: SSHConnection;
  status: 'connecting' | 'connected' | 'disconnected';
  connectedAt?: number;
}

interface ServerHomeProps {
  connections: SSHConnection[];
  sessions: HomeSession[];
  onConnect: (connection: SSHConnection) => void;
  onNew: () => void;
  onEdit: (connection: SSHConnection) => void;
  onDelete: (connection: SSHConnection) => void;
}

function statusMeta(status?: HomeSession['status']) {
  if (status === 'connected') return { label: '已连接', dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]', text: 'text-emerald-500' };
  if (status === 'connecting') return { label: '连接中', dot: 'animate-pulse bg-amber-400', text: 'text-amber-500' };
  if (status === 'disconnected') return { label: '已断开', dot: 'bg-rose-400', text: 'text-rose-500' };
  return { label: '未连接', dot: 'bg-muted-foreground/35', text: 'text-muted-foreground' };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '< 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} 天 ${remainingHours} 小时` : `${days} 天`;
}

function activityLevel(count: number) {
  if (count <= 0) return 0;
  if (count < 10) return 1;
  if (count < 50) return 2;
  if (count < 150) return 3;
  return 4;
}

function calculateStreak(activityByDay: Record<string, number>, now: Date) {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!activityByDay[localDayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activityByDay[localDayKey(cursor)] > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function UsageOverview({ sessions }: { sessions: HomeSession[] }) {
  const [usage, setUsage] = useState<UsageStats>(() => createEmptyUsageStats());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    void window.electron.usageGet()
      .then((stats) => { if (mounted) setUsage(normalizeUsageStats(stats)); })
      .catch(() => undefined);
    const unsubscribe = window.electron.onUsageStats((stats) => setUsage(normalizeUsageStats(stats)));
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const heatmapDays = useMemo(() => {
    const today = new Date(now);
    const currentSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const firstSunday = new Date(currentSunday.getTime() - 25 * 7 * DAY_MS);
    return Array.from({ length: 26 * 7 }, (_, index) => {
      const date = new Date(firstSunday.getTime() + index * DAY_MS);
      const key = localDayKey(date);
      const count = usage.activityByDay[key] || 0;
      return { key, date, count, future: date.getTime() > now };
    });
  }, [now, usage.activityByDay]);

  const activeDurations = sessions
    .filter((session) => session.status === 'connected' && session.connectedAt)
    .map((session) => Math.max(0, now - (session.connectedAt || now)));
  const activeConnectedMs = activeDurations.reduce((sum, duration) => sum + duration, 0);
  const totalConnectedMs = usage.totalConnectedMs + activeConnectedMs;
  const longestConnectionMs = Math.max(usage.longestConnectionMs, ...activeDurations, 0);
  const activeDays = Object.values(usage.activityByDay).filter((count) => count > 0).length;
  const streak = calculateStreak(usage.activityByDay, new Date(now));

  const metrics = [
    { label: '服务器操作', value: formatCount(usage.serverOperations), detail: `${formatCount(usage.successfulConnections)} 次成功连接`, icon: Activity01Icon },
    { label: '键盘操作', value: formatCount(usage.keyboardPresses), detail: `${formatCount(usage.terminalInputCharacters)} 个终端字符`, icon: KeyboardIcon },
    { label: '鼠标点击', value: formatCount(usage.mouseClicks), detail: '仅记录次数', icon: Mouse01Icon },
    { label: '最长连接', value: formatDuration(longestConnectionMs), detail: `累计 ${formatDuration(totalConnectedMs)}`, icon: Clock01Icon },
  ];

  return (
    <section className="glass-panel mt-5 overflow-hidden rounded-[28px] p-5 lg:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <HugeiconsIcon icon={CommandLineIcon} className="h-4 w-4" />
                Activity map
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em]">你的远程工作足迹</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">只统计次数、活跃度和时长，不保存命令或输入内容。</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-border/55 bg-background/34 px-3.5 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <HugeiconsIcon icon={FireIcon} className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">{streak} 天连续活跃</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">累计 {activeDays} 个活跃日</div>
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto pb-1">
            <div className="min-w-[450px]">
              <div className="grid grid-flow-col grid-rows-7 gap-1.5 [grid-auto-columns:12px]" aria-label="最近 26 周活动热力图">
                {heatmapDays.map((day) => {
                  const level = activityLevel(day.count);
                  return (
                    <div
                      key={day.key}
                      title={`${day.key} · ${day.count} 次活动`}
                      className={cn(
                        'aspect-square min-h-[11px] min-w-[11px] rounded-[3px] border transition-transform hover:scale-125',
                        day.future && 'pointer-events-none opacity-0',
                        level === 0 && 'border-border/35 bg-foreground/[0.035]',
                        level === 1 && 'border-primary/10 bg-primary/20',
                        level === 2 && 'border-primary/15 bg-primary/40',
                        level === 3 && 'border-primary/20 bg-primary/65',
                        level === 4 && 'border-primary/30 bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.32)]',
                      )}
                    />
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>最近 26 周</span>
                <div className="flex items-center gap-1.5">
                  <span>少</span>
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span
                      key={level}
                      className={cn(
                        'h-2.5 w-2.5 rounded-[3px] border',
                        level === 0 && 'border-border/35 bg-foreground/[0.035]',
                        level === 1 && 'border-primary/10 bg-primary/20',
                        level === 2 && 'border-primary/15 bg-primary/40',
                        level === 3 && 'border-primary/20 bg-primary/65',
                        level === 4 && 'border-primary/30 bg-primary',
                      )}
                    />
                  ))}
                  <span>多</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-[20px] border border-border/55 bg-background/34 p-4 transition-colors hover:bg-foreground/[0.035]">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/55 bg-background/48 text-muted-foreground">
                <HugeiconsIcon icon={metric.icon} className="h-4 w-4" />
              </div>
              <div className="mt-4 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
              <div className="mt-1.5 truncate text-xl font-semibold tracking-[-0.03em]">{metric.value}</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground">{metric.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ServerHome({ connections, sessions, onConnect, onNew, onEdit, onDelete }: ServerHomeProps) {
  const [query, setQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? connections.filter((connection) =>
      `${connection.name} ${connection.username} ${connection.host} ${(connection.tags || []).join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery))
    : connections;
  const onlineCount = sessions.filter((session) => session.status === 'connected').length;

  return (
    <main className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-6 lg:px-8 lg:py-8">
        <section className="glass-panel relative overflow-hidden rounded-[28px] px-6 py-6 lg:px-8">
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_9px_hsl(var(--primary))]" />
                Remote workspace
              </div>
              <h1 className="text-[28px] font-semibold tracking-[-0.035em]">你的服务器</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {connections.length} 个连接配置 · {onlineCount} 个在线会话
              </p>
            </div>

            <button
              type="button"
              onClick={onNew}
              className="flex h-11 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/15 transition-all hover:brightness-105 active:scale-[0.985]"
            >
              <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
              新建连接
            </button>
          </div>
        </section>

        <UsageOverview sessions={sessions} />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-[420px]">
            <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/65" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、地址或标签"
              className="glass-subtle h-11 w-full rounded-2xl pl-11 pr-10 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">显示 {filtered.length} / {connections.length}</div>
        </div>

        {connections.length === 0 ? (
          <div className="glass-panel mt-5 flex min-h-[340px] flex-col items-center justify-center rounded-[28px] px-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-border/60 bg-background/50 shadow-sm">
              <HugeiconsIcon icon={ServerStack01Icon} className="h-7 w-7 text-muted-foreground" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">从第一个连接开始</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">保存一台服务器后，就能在这里快速打开终端、文件、Docker 和监控。</p>
            <button type="button" onClick={onNew} className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background">
              <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
              新建连接
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-5 rounded-[28px] border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">没有找到匹配的服务器</div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((connection) => {
              const session = sessions.find((item) => item.connection.id === connection.id);
              const status = statusMeta(session?.status);
              const deleting = pendingDeleteId === connection.id;
              return (
                <article key={connection.id} className="glass-panel surface-hover group relative min-h-[220px] overflow-hidden rounded-[26px] p-5">
                  <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-primary/[0.055] blur-3xl transition-opacity group-hover:opacity-100" />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start gap-3.5">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/52 shadow-sm">
                        <HugeiconsIcon icon={ServerStack01Icon} className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[15px] font-semibold tracking-tight">{connection.name}</h3>
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', status.dot)} />
                        </div>
                        <div className={cn('mt-1 text-[11px] font-medium', status.text)}>{status.label}</div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-border/50 bg-background/34 px-3.5 py-3">
                      <div className="truncate font-mono text-xs text-foreground/85">{connection.username || 'root'}@{connection.host}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>端口 {connection.port || 22}</span>
                        <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                        <HugeiconsIcon icon={Key02Icon} className="h-3 w-3" />
                        <span>{connection.authType === 'privateKey' ? '私钥' : '密码'}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">
                      {(connection.tags || []).slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full border border-border/55 bg-background/38 px-2 py-1 text-[9px] text-muted-foreground">{tag}</span>
                      ))}
                    </div>

                    <div className="mt-auto flex items-center justify-between border-t border-border/45 pt-4">
                      {deleting ? (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">确认删除？</span>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setPendingDeleteId(null)} className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06]">取消</button>
                            <button type="button" onClick={() => { setPendingDeleteId(null); onDelete(connection); }} className="h-8 rounded-xl bg-rose-500/12 px-3 text-xs font-medium text-rose-500 hover:bg-rose-500/18">删除</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => onEdit(connection)} className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title="编辑">
                              <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => setPendingDeleteId(connection.id)} className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500" title="删除">
                              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <button type="button" onClick={() => onConnect(connection)} className="flex h-9 items-center gap-2 rounded-xl bg-foreground px-3.5 text-xs font-medium text-background transition-all hover:opacity-90 active:scale-[0.985]">
                            {session ? '打开会话' : '连接'}
                            <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
