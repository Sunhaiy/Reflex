// AgentSessionSidebar - Lists and manages saved Agent conversations
// Sessions are filtered by profileId (server), newest first.
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
            if (language === 'zh') return `${mins}分钟前`;
            if (language === 'ja') return `${mins}分前`;
            if (language === 'ko') return `${mins}분 전`;
            return `${mins}m ago`;
        }
        if (hours < 24) {
            if (language === 'zh') return `${hours}小时前`;
            if (language === 'ja') return `${hours}時間前`;
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
            if (language === 'zh') return `${days}天前`;
            if (language === 'ja') return `${days}日前`;
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
    const { t } = useTranslation();
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

    return (
        <div className="flex flex-col h-full border-r border-border/40 bg-sidebar/40 shrink-0 overflow-hidden" style={style}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/70">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {t('agent.sessionHistory')}
                </div>
                <button
                    onClick={onNewSession}
                    className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
                    title={t('agent.newSession')}
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto py-1">
                {sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-2">
                        <MessageSquare className="w-6 h-6 text-muted-foreground/20" />
                        <p className="text-[11px] text-muted-foreground/40 leading-snug">
                            {t('agent.noHistory')}
                        </p>
                    </div>
                ) : (
                    sessions.map(session => (
                        <div
                            key={session.id}
                            onClick={() => onSelectSession(session)}
                            className={cn(
                                'group relative mx-1 my-0.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors text-xs',
                                currentSessionId === session.id
                                    ? 'bg-primary/10 text-foreground'
                                    : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <div className="font-medium truncate pr-5 leading-snug">
                                {session.title || t('agent.newSession')}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground/50">
                                <Clock className="w-2.5 h-2.5" />
                                {relativeTime(session.updatedAt)}
                                <span className="mx-0.5">·</span>
                                {session.messages.filter(m => m.role === 'user').length} {t('agent.messages')}
                            </div>
                            {/* Delete button */}
                            <button
                                onClick={e => handleDelete(session.id, e)}
                                className={cn(
                                    'absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100',
                                    pendingDelete === session.id
                                        ? 'bg-destructive text-white opacity-100'
                                        : 'hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40'
                                )}
                                title={pendingDelete === session.id ? t('common.confirm') : t('common.delete')}
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
