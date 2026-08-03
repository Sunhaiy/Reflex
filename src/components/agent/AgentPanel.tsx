import { HugeiconsIcon } from '@hugeicons/react';
import {
  FolderOpenIcon,
  PlusSignIcon,
  SentIcon,
  StopIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useAgent } from '../../hooks/useAgent';
import { useTranslation } from '../../hooks/useTranslation';
import type { AgentMode } from '../../shared/agent';
import { AGENT_MODES, MODE_HINT, MODE_LABEL } from './modes';
import { ApprovalCard } from './ApprovalCard';
import { ToolCard } from './ToolCard';

export function AgentPanel({ sessionId, serverLabel }: { sessionId: string; serverLabel: string }) {
  const { t } = useTranslation();
  const agent = useAgent(sessionId, serverLabel);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // Follows the conversation only while the user is already at the bottom, so scrolling
  // up to read an earlier command does not get yanked back on the next token.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && atBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [agent.blocks, agent.pending]);

  const mode = agent.config?.mode ?? 'ask';
  const setMode = (next: AgentMode) => {
    void window.electron.agentConfigSet({ mode: next }).then(() => agent.refreshConfig());
  };

  const submit = () => {
    if (!draft.trim() || agent.busy) return;
    void agent.send(draft);
    setDraft('');
  };

  const folderName = agent.localRoot?.split(/[\\/]/).filter(Boolean).pop() ?? '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/45 px-2.5 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/[0.045] p-0.5">
          {AGENT_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              title={t(MODE_HINT[option])}
              className={cn(
                'h-6 rounded-md px-2 text-[10.5px] font-medium transition-colors',
                mode === option
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(MODE_LABEL[option])}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => (agent.localRoot ? agent.clearFolder() : void agent.shareFolder())}
          title={agent.localRoot ? t('agent.folderClear') : t('agent.folderHint')}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {agent.localRoot ? t('agent.folderShared', { name: folderName }) : t('agent.folderNone')}
          </span>
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={agent.reset}
          title={t('agent.newTask')}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2.5 py-2.5"
      >
        {agent.blocks.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[13px] font-medium">{t('agent.emptyTitle')}</p>
            <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
              {t('agent.emptyHint')}
            </p>
          </div>
        )}

        {agent.blocks.map((block) => {
          if (block.kind === 'user') {
            return (
              <div key={block.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-foreground/[0.08] px-2.5 py-1.5 text-[12px] leading-5">
                  {block.text}
                </div>
              </div>
            );
          }

          if (block.kind === 'text') {
            return (
              <p key={block.id} className="whitespace-pre-wrap break-words text-[12px] leading-[1.65] text-foreground/90">
                {block.text}
              </p>
            );
          }

          if (block.kind === 'note') {
            return (
              <p key={block.id} className={cn(
                'rounded-lg px-2.5 py-1.5 text-[11px] leading-5',
                block.tone === 'error' ? 'bg-rose-500/[0.07] text-rose-500' : 'text-muted-foreground',
              )}>
                {block.text}
              </p>
            );
          }

          if (block.kind === 'stopped') {
            return (
              <p key={block.id} className="text-[11px] leading-5 text-muted-foreground">
                {t('agent.stoppedMaxTurns', { count: block.turns })}
              </p>
            );
          }

          return (
            <ToolCard key={block.id} block={block}>
              {agent.pending?.callId === block.id && (
                <ApprovalCard
                  question={agent.pending}
                  onAnswer={(answer) => agent.answer(block.id, answer)}
                />
              )}
            </ToolCard>
          );
        })}
      </div>

      {agent.config && !agent.config.hasKey && (
        <p className="shrink-0 border-t border-border/45 bg-amber-500/[0.07] px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          {t('agent.needsKey')}
        </p>
      )}

      <div className="shrink-0 border-t border-border/45 p-2">
        <div className="flex items-end gap-1.5 rounded-xl border border-border/55 bg-background/45 px-2 py-1.5 focus-within:border-foreground/25">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; a newline needs Shift, matching every chat surface.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={t('agent.placeholder')}
            className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent text-[12px] leading-[1.5] outline-none placeholder:text-muted-foreground/70"
          />

          {agent.busy ? (
            <button
              type="button"
              onClick={agent.stop}
              title={t('agent.stop')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <HugeiconsIcon icon={StopIcon} className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              title={t('agent.send')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <HugeiconsIcon icon={SentIcon} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
