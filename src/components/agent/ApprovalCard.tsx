import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import type { ApprovalAnswer, ApprovalQuestion } from '../../shared/agent';

const buttonClass = 'h-7 rounded-lg px-2.5 text-[11px] font-medium transition-colors';

export function ApprovalCard({ question, onAnswer }: {
  question: ApprovalQuestion;
  onAnswer: (answer: ApprovalAnswer) => void;
}) {
  const { t } = useTranslation();
  // An empty group marks a command from the always-confirm list. Those are asked about
  // every single time, so offering to stop asking would be a lie.
  const canRemember = question.group.length > 0;
  const dangerous = !canRemember;

  return (
    <div className={cn(
      'border-t px-2.5 py-2',
      dangerous ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-border/45 bg-foreground/[0.03]',
    )}>
      {dangerous && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-rose-500">
          <HugeiconsIcon icon={Alert02Icon} className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{question.reason}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAnswer('allow')}
          className={cn(buttonClass, 'bg-foreground text-background hover:bg-foreground/85')}
        >
          {t('agent.approve')}
        </button>

        {canRemember && (
          <button
            type="button"
            onClick={() => onAnswer('always')}
            className={cn(buttonClass, 'bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.12]')}
          >
            {t('agent.approveAlways', { group: question.group })}
          </button>
        )}

        <button
          type="button"
          onClick={() => onAnswer('deny')}
          className={cn(buttonClass, 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground')}
        >
          {t('agent.deny')}
        </button>
      </div>
    </div>
  );
}
