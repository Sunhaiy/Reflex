import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { AgentBlock } from '../../hooks/useAgent';
import type { ApprovalAnswer, ApprovalQuestion } from '../../shared/agent';
import { useTranslation } from '../../hooks/useTranslation';
import { AgentMarkdown } from './AgentMarkdown';
import { ApprovalCard } from './ApprovalCard';
import { ToolCard } from './ToolCard';
import {
  AnimatedGlobe,
  ProcessCheck,
  ProcessDots,
  ProcessError,
  ProcessCaret,
  ProcessSpark,
} from './ProcessIcons';
import styles from './AgentProcess.module.css';

type UserBlock = Extract<AgentBlock, { kind: 'user' }>;

export interface AgentTurnData {
  id: string;
  user: UserBlock | null;
  response: AgentBlock[];
}

export function groupAgentTurns(blocks: AgentBlock[]): AgentTurnData[] {
  const turns: AgentTurnData[] = [];
  let current: AgentTurnData | null = null;

  for (const block of blocks) {
    if (block.kind === 'user') {
      current = { id: block.id, user: block, response: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { id: `orphan-${block.id}`, user: null, response: [] };
      turns.push(current);
    }
    current.response.push(block);
  }
  return turns;
}

export function AgentTurn({
  turn,
  busy,
  pending,
  onAnswer,
}: {
  turn: AgentTurnData;
  busy: boolean;
  pending: ApprovalQuestion | null;
  onAnswer: (callId: string, answer: ApprovalAnswer) => void;
}) {
  const last = turn.response[turn.response.length - 1];
  const result = !busy && last?.kind === 'text' ? last : null;
  const processBlocks = result ? turn.response.slice(0, -1) : turn.response;
  const hasProcessEvent = processBlocks.some((block) => block.kind !== 'text');
  const showProcess = busy || hasProcessEvent;

  return (
    <div className="space-y-2">
      {turn.user && (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-foreground/[0.08] px-2.5 py-1.5 text-[12px] leading-5">
            {turn.user.text}
          </div>
        </div>
      )}

      {showProcess && (
        <AgentProcess
          blocks={processBlocks}
          busy={busy}
          pending={pending}
          onAnswer={onAnswer}
        />
      )}

      {!showProcess && processBlocks.map((block) => (
        block.kind === 'text'
          ? <AgentMarkdown key={block.id} source={block.text} streaming={block.streaming} />
          : null
      ))}

      {result && (
        <AgentMarkdown
          source={result.text}
          streaming={false}
          className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
        />
      )}
    </div>
  );
}

function AgentProcess({
  blocks,
  busy,
  pending,
  onAnswer,
}: {
  blocks: AgentBlock[];
  busy: boolean;
  pending: ApprovalQuestion | null;
  onAnswer: (callId: string, answer: ApprovalAnswer) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasError = blocks.some((block) => (
    (block.kind === 'tool' && block.isError)
    || (block.kind === 'note' && block.tone === 'error')
    || block.kind === 'stopped'
  ));
  const stepCount = Math.max(1, blocks.filter((block) => block.kind === 'tool').length);
  const label = busy
    ? t('agent.processing')
    : hasError
      ? t('agent.processFailed')
      : t('agent.processComplete', { count: stepCount });

  return (
    <section className={styles.process} data-state={busy ? 'loading' : (hasError ? 'error' : 'done')}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          {busy ? <ProcessSpark /> : (hasError ? <ProcessError /> : <ProcessCheck />)}
        </span>
        <span className={cn(styles.label, busy && styles.shimmer, hasError && styles.failed)}>
          {label}
        </span>
        {blocks.length > 0 && (
          <button
            type="button"
            className={cn(styles.chevron, !open && styles.chevronCollapsed)}
            aria-label={t('agent.toggleProcess')}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <ProcessCaret />
          </button>
        )}
      </div>

      <div
        className={cn(styles.collapsible, !open && styles.collapsed)}
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
      >
        <div className={styles.collapsibleInner}>
          <div className={styles.results}>
            {blocks.length > 1 && <span className={styles.rail} />}
            {blocks.map((block) => {
              if (block.kind === 'tool') {
                return (
                  <ToolCard key={block.id} block={block}>
                    {pending?.callId === block.id && (
                      <ApprovalCard
                        question={pending}
                        onAnswer={(answer) => onAnswer(block.id, answer)}
                      />
                    )}
                  </ToolCard>
                );
              }

              if (block.kind === 'text') {
                return (
                  <div key={block.id} className={styles.step}>
                    <span className={cn(styles.bullet, block.streaming && styles.bulletRunning)}>
                      {block.streaming ? <AnimatedGlobe /> : <ProcessDots />}
                    </span>
                    <div className={styles.textStep}>
                      <AgentMarkdown source={block.text} streaming={block.streaming} />
                    </div>
                  </div>
                );
              }

              const error = block.kind === 'note' && block.tone === 'error';
              const text = block.kind === 'compacted'
                ? t('agent.compacted')
                : block.kind === 'stopped'
                  ? t('agent.stoppedMaxTurns', { count: block.turns })
                  : block.text;
              return (
                <div key={block.id} className={styles.step}>
                  <span className={cn(styles.bullet, error ? styles.bulletError : styles.bulletDone)}>
                    {error ? <ProcessError /> : <ProcessCheck />}
                  </span>
                  <p className={cn(styles.note, error && styles.noteError)}>{text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
