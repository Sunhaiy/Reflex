import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import { Plus, Trash2, MessageSquare, Clock, Bot } from 'lucide-react';
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
}

function useRelativeTime() {
    const { t, language } = useTranslation();
    return (ts: number): string => {
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return t('agent.justNow');
        if (mins < 60) {
            if (language === 'zh') return `${mins} 分钟前`;
            if (language === 'ja') return `${mins} 分前`;
            if (language === 'ko') return `${mins}분 전`;
            return `${mins}m ago`;
        }
        if (hours < 24) {
            if (language === 'zh') return `${hours} 小时前`;
            if (language === 'ja') return `${hours} 時間前`;
            if (language === 'ko') return `${hours}시간 전`;
            return `${hours}h ago`;
        }
        if (days === 1) {
            if (language === 'zh') return '昨天';
            if (language === 'ja') return '昨日';
            if (language === 'ko') return '어제';
            return 'Yesterday';
        }
        if (days < 30) {
            if (language === 'zh') return `${days} 天前`;
            if (language === 'ja') return `${days} 日前`;
            if (language === 'ko') return `${days}일 전`;
            return `${days}d ago`;
        }

        return new Date(ts).toLocaleDateString(
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

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingDelete === id) {
            await (window as any).electron.agentSessionDelete(id);
            setSessions(prev => prev.filter(s => s.id !== id));
            setPendingDelete(null);
        } else {
            setPendingDelete(id);
            setTimeout(() => setPendingDelete(prev => prev === id ? null : prev), 3000);
        }
    };

    const emptyText = language === 'zh' ? '新的目标会在这里沉淀成会话。' : 'New objectives will show up here as threads.';
    const subtitle = language === 'zh' ? '最近对话' : 'Recent Threads';

    return (
        <div
            className="flex h-full shrink-0 flex-col overflow-hidden border-r border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))]"
            style={style}
        >
            <div className="border-b border-white/8 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                            <Bot className="h-3 w-3" />
                            {subtitle}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-foreground/92">
                            {t('agent.sessionHistory')}
                        </div>
                    </div>
                    <button
                        onClick={onNewSession}
                        className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition-all hover:border-primary/30 hover:bg-primary/15 hover:shadow-[0_8px_22px_rgba(16,185,129,0.14)]"
                        title={t('agent.newSession')}
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
                {sessions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/8 bg-white/4 text-muted-foreground/40">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground/75">{t('agent.noHistory')}</p>
                            <p className="text-[11px] leading-relaxed text-muted-foreground/45">{emptyText}</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sessions.map(session => {
                            const latestMessage = [...session.messages].reverse().find(message => message.content?.trim());
                            const preview = latestMessage?.content?.replace(/\s+/g, ' ').slice(0, 72) || session.host;
                            const userCount = session.messages.filter(message => message.role === 'user').length;

                            return (
                                <div
                                    key={session.id}
                                    onClick={() => onSelectSession(session)}
                                    className={cn(
                                        'group relative overflow-hidden rounded-2xl border px-3 py-3 transition-all duration-200 cursor-pointer',
                                        currentSessionId === session.id
                                            ? 'border-primary/25 bg-primary/10 shadow-[0_12px_28px_rgba(16,185,129,0.12)]'
                                            : 'border-white/6 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.05]'
                                    )}
                                >
                                    {currentSessionId === session.id && (
                                        <div className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-primary" />
                                    )}

                                    <div className="pr-9">
                                        <div className="truncate text-sm font-medium text-foreground/90">
                                            {session.title || t('agent.newSession')}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/58">
                                            {preview}
                                        </p>
                                    </div>

                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/55">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/4 px-2 py-1">
                                            <Clock className="h-2.5 w-2.5" />
                                            {relativeTime(session.updatedAt)}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/4 px-2 py-1">
                                            <MessageSquare className="h-2.5 w-2.5" />
                                            {userCount} {t('agent.messages')}
                                        </span>
                                    </div>

                                    <button
                                        onClick={e => handleDelete(session.id, e)}
                                        className={cn(
                                            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-xl border transition-all opacity-0 group-hover:opacity-100',
                                            pendingDelete === session.id
                                                ? 'border-destructive/30 bg-destructive text-white opacity-100'
                                                : 'border-white/8 bg-black/10 text-muted-foreground/45 hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive'
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
