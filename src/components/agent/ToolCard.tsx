import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  File01Icon,
  FileEditIcon,
  FolderOpenIcon,
  Loading02Icon,
  SourceCodeIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import type { AgentBlock } from '../../hooks/useAgent';

const ICONS: Record<string, typeof File01Icon> = {
  shell: SourceCodeIcon,
  read_file: File01Icon,
  write_file: FileEditIcon,
  edit_file: FileEditIcon,
  upload_project: CloudUploadIcon,
  list_local: FolderOpenIcon,
  read_local: File01Icon,
};

type ToolBlock = Extract<AgentBlock, { kind: 'tool' }>;

/**
 * The one line that says what the agent is doing. A shell call shows its command, since
 * that is the whole of what the user is being asked to trust; the file tools show the
 * path they touch.
 */
function summarise(block: ToolBlock): string {
  const input = block.input;
  if (typeof input.command === 'string') return input.command;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.local_path === 'string' && typeof input.remote_path === 'string') {
    return `${input.local_path} → ${input.remote_path}`;
  }
  return block.tool;
}

export function ToolCard({ block, children }: { block: ToolBlock; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const streamRef = useRef<HTMLPreElement>(null);

  const body = block.done ? (block.result ?? '') : block.output;
  const hasBody = body.trim().length > 0;

  // Follows the output while it streams, so a running build stays at the newest line.
  useEffect(() => {
    if (!open || block.done) return;
    const element = streamRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [block.done, body, open]);

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border transition-colors',
      block.isError ? 'border-rose-500/30 bg-rose-500/[0.04]' : 'border-border/55 bg-foreground/[0.02]',
    )}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <HugeiconsIcon
          icon={ICONS[block.tool] ?? SourceCodeIcon}
          className={cn('h-3.5 w-3.5 shrink-0', block.isError ? 'text-rose-500' : 'text-muted-foreground')}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85">
          {summarise(block)}
        </span>

        {!block.done && (
          <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {block.done && !block.isError && (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        {block.done && block.isError && (
          <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5 shrink-0 text-rose-500" />
        )}

        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border/45 px-2.5 py-2">
          <pre
            ref={streamRef}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.5] text-muted-foreground"
          >
            {hasBody ? body : t('agent.noOutput')}
          </pre>
        </div>
      )}

      {children}
    </div>
  );
}
