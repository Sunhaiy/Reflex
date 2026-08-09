import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUp02Icon,
  FolderOpenIcon,
  StopIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import type { AgentController } from '../../hooks/useAgent';
import { useTranslation } from '../../hooks/useTranslation';
import type { AgentMode } from '../../shared/agent';
import { AGENT_MODES, EFFORT_NAME, MODE_HINT, MODE_LABEL } from './modes';
import { CompactMenu } from './CompactMenu';
import { ContextRing } from './ContextRing';
import { EffortSlider } from './EffortSlider';
import { AgentTurn, groupAgentTurns } from './AgentProcess';
import { ProviderMark, providerMarkFromModel } from './ProviderMark';

export function AgentPanel({ agent }: { agent: AgentController }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && atBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [agent.blocks, agent.pending]);

  const mode = agent.config?.mode ?? 'free';
  const models = agent.config?.models ?? [];
  const budget = agent.config?.contextBudget ?? 60_000;
  const effort = agent.config?.effort ?? 'auto';
  const turns = groupAgentTurns(agent.blocks);

  const submit = () => {
    if (!draft.trim() || agent.busy) return;
    void agent.send(draft);
    setDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2.5 py-2.5"
      >
        {agent.blocks.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <p className="text-[13px] font-medium">{t('agent.emptyTitle')}</p>
            <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
              {t('agent.emptyHint')}
            </p>
          </div>
        )}

        {turns.map((turn, index) => (
          <AgentTurn
            key={turn.id}
            turn={turn}
            busy={agent.busy && index === turns.length - 1}
            pending={agent.pending}
            onAnswer={agent.answer}
          />
        ))}

        {agent.needsFolder && !agent.localRoot && (
          <div className="rounded-xl border border-border/55 bg-foreground/[0.03] px-2.5 py-2">
            <p className="text-[11px] leading-5 text-muted-foreground">{t('agent.needFolder')}</p>
            <button
              type="button"
              onClick={() => void agent.shareFolder()}
              className="mt-1.5 flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.07] px-2.5 text-[11px] font-medium transition-colors hover:bg-foreground/[0.12]"
            >
              <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
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
        <div className="relative rounded-xl border border-border/55 bg-background/45 transition-colors focus-within:border-foreground/25">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder={t('agent.placeholder')}
            className="max-h-56 min-h-[84px] w-full resize-none bg-transparent py-3 pl-3 pr-12 text-[12.5px] leading-[1.55] outline-none placeholder:text-muted-foreground/70"
          />

          {agent.busy ? (
            <button
              type="button"
              onClick={agent.stop}
              title={t('agent.stop')}
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.08] text-foreground transition-colors hover:bg-foreground/[0.13]"
            >
              <HugeiconsIcon icon={StopIcon} className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              title={t('agent.send')}
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[background-color,transform,opacity] hover:bg-primary/90 active:scale-95 disabled:bg-foreground/[0.06] disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-foreground/[0.06]"
            >
              <HugeiconsIcon icon={ArrowUp02Icon} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
          <CompactMenu
            value={mode}
            width={96}
            tone="accent"
            options={AGENT_MODES.map((option) => ({
              value: option,
              label: t(MODE_LABEL[option]),
              hint: t(MODE_HINT[option]),
            }))}
            onChange={(next) => agent.setMode(next as AgentMode)}
          />

          <CompactMenu
            value={agent.config?.model ?? ''}
            title={t('agent.model')}
            width={140}
            options={models.length > 0
              ? models.map((id) => ({
                  value: id,
                  label: id,
                  icon: (
                    <ProviderMark
                      provider={providerMarkFromModel(id, agent.config?.baseUrl)}
                      className="h-5 w-5 rounded-md"
                    />
                  ),
                }))
              : [{
                  value: agent.config?.model ?? '',
                  label: t('agent.noModels'),
                  icon: (
                    <ProviderMark
                      provider={providerMarkFromModel(agent.config?.model ?? '', agent.config?.baseUrl)}
                      className="h-5 w-5 rounded-md"
                    />
                  ),
                }]}
            onChange={(next) => agent.setModel(next)}
          />

          <CompactMenu
            value={effort}
            width={82}
            label={EFFORT_NAME[effort]}
            title={t('settings.agent.effort')}
            panel={<EffortSlider value={effort} onChange={agent.setEffort} />}
          />

          <ContextRing used={agent.contextTokens} budget={budget} spent={agent.spentTokens} />
        </div>
      </div>
    </div>
  );
}
