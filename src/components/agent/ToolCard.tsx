import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../hooks/useTranslation';
import type { AgentBlock } from '../../hooks/useAgent';
import {
  AnimatedGlobe,
  ProcessCaret,
  ProcessCheck,
  ProcessError,
} from './ProcessIcons';
import styles from './AgentProcess.module.css';

const TOOL_LABELS = {
  shell: 'agent.toolShell',
  read_file: 'agent.toolReadFile',
  write_file: 'agent.toolWriteFile',
  edit_file: 'agent.toolEditFile',
  upload_project: 'agent.toolUploadProject',
  list_local: 'agent.toolListLocal',
  read_local: 'agent.toolReadLocal',
} as const;

type ToolBlock = Extract<AgentBlock, { kind: 'tool' }>;

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
  const body = block.done ? (block.result ?? block.output) : block.output;
  const hasBody = body.trim().length > 0;
  const labelKey = TOOL_LABELS[block.tool as keyof typeof TOOL_LABELS];

  useEffect(() => {
    if (block.done && block.isError) setOpen(true);
  }, [block.done, block.isError]);

  useEffect(() => {
    if (!open || block.done) return;
    const element = streamRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [block.done, body, open]);

  return (
    <div className={styles.step} data-state={!block.done ? 'loading' : (block.isError ? 'error' : 'done')}>
      <span className={cn(
        styles.bullet,
        !block.done && styles.bulletRunning,
        block.done && !block.isError && styles.bulletDone,
        block.isError && styles.bulletError,
      )}>
        {!block.done && <AnimatedGlobe />}
        {block.done && !block.isError && <ProcessCheck />}
        {block.done && block.isError && <ProcessError />}
      </span>

      <button
        type="button"
        className={styles.toolButton}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn(styles.stepTitle, !block.done && styles.shimmer)}>
          {labelKey ? t(labelKey) : t('agent.execution')}
        </span>
        <span className={styles.separator}>·</span>
        <span className={styles.stepMeta} title={summarise(block)}>{summarise(block)}</span>
        <span className={cn(styles.rowCaret, open && styles.rowCaretOpen)}>
          <ProcessCaret />
        </span>
      </button>

      <div
        className={cn(styles.details, open && styles.detailsOpen)}
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
      >
        <div className={styles.detailsInner}>
          <pre
            ref={streamRef}
            className={cn(styles.output, block.isError && styles.errorOutput)}
          >
            {hasBody ? body : t('agent.noOutput')}
          </pre>
        </div>
      </div>

      {children && <div className="mt-1.5 overflow-hidden rounded-lg">{children}</div>}
    </div>
  );
}
