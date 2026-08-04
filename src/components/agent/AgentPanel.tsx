import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlignBoxBottomCenterIcon,
  AlignBoxMiddleRightIcon,
  FolderOpenIcon,
  PlusSignIcon,
  SentIcon,
  StopIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { AgentController } from '../../hooks/useAgent';
import { useTranslation } from '../../hooks/useTranslation';
import type { AgentMode } from '../../shared/agent';
import { AGENT_MODES, MODE_HINT, MODE_LABEL } from './modes';
import { HeaderMenu } from './HeaderMenu';
import { ApprovalCard } from './ApprovalCard';
import { ToolCard } from './ToolCard';

export function AgentPanel({ agent }: { agent: AgentController }) {
  const { t } = useTranslation();
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
  const dock = agent.config?.dock ?? 'bottom';
  const setMode = (next: AgentMode) => {
    void window.electron.agentConfigSet({ mode: next }).then(() => agent.refreshConfig());
  };

  const submit = () => {
    if (!draft.trim() || agent.busy) return;
    void agent.send(draft);
    setDraft('');
  };

  const models = agent.config?.models ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border/45 px-2 py-1.5">
        <HeaderMenu
          value={mode}
          tone={mode === 'free' ? 'alert' : 'default'}
          options={AGENT_MODES.map((option) => ({
            value: option,
            label: t(MODE_LABEL[option]),
            hint: t(MODE_HINT[option]),
          }))}
          onChange={(next) => setMode(next as AgentMode)}
        />

        {/* Switching model is a panel-level decision, not a settings trip: which model
            suits a task changes with the task. The list is whatever the last sync found. */}
        <HeaderMenu
          value={agent.config?.model ?? ''}
          title={t('agent.model')}
          maxWidth={150}
          options={models.length > 0
            ? models.map((id) => ({ value: id, label: id }))
            : [{ value: agent.config?.model ?? '', label: t('agent.noModels') }]}
          onChange={(next) => agent.setModel(next)}
        />

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => agent.setDock(dock === 'bottom' ? 'right' : 'bottom')}
          title={dock === 'bottom' ? t('agent.dockRight') : t('agent.dockBottom')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon
            icon={dock === 'bottom' ? AlignBoxMiddleRightIcon : AlignBoxBottomCenterIcon}
            className="h-3.5 w-3.5"
          />
        </button>

        <button
          type="button"
          onClick={agent.reset}
          title={t('agent.newTask')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
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

        {/* Folder sharing is asked for at the moment it is needed rather than sitting in
            the header. It is only relevant when deploying from this machine, which is a
            fraction of what the agent gets asked to do. */}
        {agent.needsFolder && !agent.localRoot && (
          <div className="rounded-xl border border-border/55 bg-foreground/[0.03] px-2.5 py-2">
            <p className="text-[11px] leading-5 text-muted-foreground">{t('agent.needFolder')}</p>
            <button
              type="button"
              onClick={() => void agent.shareFolder()}
              className="mt-1.5 flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.07] px-2.5 text-[11px] font-medium transition-colors hover:bg-foreground/[0.12]"
            >
              <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
              {t('agent.shareFolder')}
            </button>
          </div>
        )}
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
