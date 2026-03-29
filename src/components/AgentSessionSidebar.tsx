import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import { Plus, Trash2, MessageSquare, Clock } from 'lucide-react';
import { AgentSession } from '../shared/types';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

interface AgentSessionSidebarProps {
    profileId: string;
    currentSessionId: string | null;
    onSelectSession: (session: AgentSession) => void;
    onNewSession: () => void;
    refreshTrigger?: number;
    style?: React.CSSProperties;
    showHeader?: boolean;
}

function useRelativeTime() {
    const { t, language } = useTranslation();
    return (timestamp: number): string => {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('agent.justNow');
        if (minutes < 60) return language === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`;
        if (hours < 24) return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`;
        if (days === 1) return language === 'zh' ? '昨天' : 'Yesterday';
        if (days < 30) return language === 'zh' ? `${days} 天前` : `${days}d ago`;

        return new Date(timestamp).toLocaleDateString(
            language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : language === 'ko' ? 'ko-KR' : 'en-US',
            { month: 'short', day: 'numeric' }
        );
    };
}

export function AgentSessionSidebar({
    profileId,
    currentSessionId,
    onSelectSession,
    onNewSession,
    refreshTrigger,
    style,
    showHeader = true,
}: AgentSessionSidebarProps) {
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const { t, language } = useTranslation();
    const relativeTime = useRelativeTime();

    const load = useCallback(async () => {
        if (!profileId) return;
        try {
            const list = await (window as any).electron.agentSessionList(profileId);
            setSessions(list || []);
        } catch { }
    }, [profileId]);

    useEffect(() => { load(); }, [load, refreshTrigger]);

    const handleDelete = async (id: string, event: React.MouseEvent) => {
        event.stopPropagation();
        if (pendingDelete === id) {
            await (window as any).electron.agentSessionDelete(id);
            setSessions((prev) => prev.filter((session) => session.id !== id));
            setPendingDelete(null);
        } else {
            setPendingDelete(id);
            setTimeout(() => setPendingDelete((prev) => prev === id ? null : prev), 3000);
        }
    };

    const emptyTitle = language === 'zh' ? '还没有历史会话' : 'No history yet';
    const emptyText = language === 'zh'
        ? '新的任务会在这里沉淀成线程，方便继续接着做。'
        : 'New tasks will settle here as reusable threads.';
    const recentLabel = language === 'zh' ? '最近会话' : 'Recent Threads';
    const newSessionLabel = language === 'zh' ? '新建' : 'New';

    return (
        <div
            className={cn(
                "flex h-full shrink-0 flex-col overflow-hidden bg-card/92",
                showHeader ? "border-r border-border/60" : ""
            )}
            style={style}
        >
            {showHeader && (
                <div className="border-b border-border/60 px-4 py-4">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                                {recentLabel}
                            </div>
                            <div className="mt-2 text-base font-semibold text-foreground">{t('agent.sessionHistory')}</div>
                        </div>
                        <button
                            onClick={onNewSession}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-background/90 px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/55"
                            title={t('agent.newSession')}
                        >
                            <Plus className="h-4 w-4" />
                            {newSessionLabel}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {sessions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-background/90 text-muted-foreground shadow-sm">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground/82">{emptyTitle}</p>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">{emptyText}</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sessions.map((session) => {
                            const latestMessage = [...session.messages].reverse().find((message) => message.content?.trim());
                            const preview = latestMessage?.content?.replace(/\s+/g, ' ').slice(0, 72) || session.host;
                            const userCount = session.messages.filter((message) => message.role === 'user').length;
                            const active = currentSessionId === session.id;

                            return (
                                <div
                                    key={session.id}
                                    onClick={() => onSelectSession(session)}
                                    className={cn(
                                        'group relative cursor-pointer rounded-2xl border px-3.5 py-3.5 transition-all',
                                        active
                                            ? 'border-border bg-background/92 shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
                                            : 'border-transparent bg-transparent hover:border-border/60 hover:bg-background/70'
                                    )}
                                >
                                    {active && (
                                        <div className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-foreground/75" />
                                    )}

                                    <div className="pr-10">
                                        <div className="truncate text-sm font-medium text-foreground">
                                            {session.title || t('agent.newSession')}
                                        </div>
                                        <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                                            {preview}
                                        </p>
                                    </div>

                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2 py-1">
                                            <Clock className="h-2.5 w-2.5" />
                                            {relativeTime(session.updatedAt)}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2 py-1">
                                            <MessageSquare className="h-2.5 w-2.5" />
                                            {userCount} {t('agent.messages')}
                                        </span>
                                    </div>

                                    <button
                                        onClick={(event) => handleDelete(session.id, event)}
                                        className={cn(
                                            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-xl border transition-all opacity-0 group-hover:opacity-100',
                                            pendingDelete === session.id
                                                ? 'border-destructive/30 bg-destructive text-white opacity-100'
                                                : 'border-border/60 bg-background/90 text-muted-foreground hover:border-destructive/20 hover:bg-destructive/8 hover:text-destructive'
                                        )}
                                        title={pendingDelete === session.id ? t('common.confirm') : t('common.delete')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
