import { HugeiconsIcon } from '@hugeicons/react';
import { MessageMultiple01Icon, PlusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentController } from '../../hooks/useAgent';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { workspaceIconButtonClass } from '../workspaceChrome';

const MENU_WIDTH = 260;
const VIEWPORT_MARGIN = 8;

interface MenuPosition {
  left: number;
  top: number;
}

/** Conversation-level actions shown at the top right of the Agent tab. */
export function AgentHeaderActions({ agent }: { agent: AgentController }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const conversations = useMemo(
    () => [...agent.conversations].sort((a, b) => b.createdAt - a.createdAt),
    [agent.conversations],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const bounds = triggerRef.current.getBoundingClientRect();
    setPosition({
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, bounds.right - MENU_WIDTH),
        window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
      ),
      top: bounds.bottom + 5,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={t('agent.switchConversation')}
        aria-label={t('agent.switchConversation')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(workspaceIconButtonClass, open && 'bg-foreground/[0.075] text-foreground')}
      >
        <HugeiconsIcon icon={MessageMultiple01Icon} className="h-4 w-4" />
      </button>

      <button
        type="button"
        title={t('agent.newConversation')}
        aria-label={t('agent.newConversation')}
        onClick={() => {
          setOpen(false);
          agent.newConversation();
        }}
        className={workspaceIconButtonClass}
      >
        <HugeiconsIcon icon={PlusSignIcon} className="h-4 w-4" />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('agent.switchConversation')}
          style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
          className="glass-panel fixed z-[9999] max-h-[min(320px,calc(100vh-64px))] space-y-1 overflow-y-auto rounded-xl p-1 animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
        >
          {conversations.map((conversation, index) => {
            const selected = conversation.id === agent.activeConversationId;
            const title = conversation.title || `${t('agent.newConversation')} ${agent.conversations.length - index}`;
            return (
              <button
                key={conversation.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  agent.switchConversation(conversation.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'bg-foreground/[0.09] text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground',
                )}
              >
                <span className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  conversation.busy ? 'animate-pulse bg-primary' : 'bg-foreground/20',
                )} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{title}</span>
                <HugeiconsIcon
                  icon={Tick02Icon}
                  className={cn('h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                />
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
