import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from './StreamingText.module.css';

export function StreamingText({
  children,
  streaming,
  className,
}: {
  children: ReactNode;
  streaming: boolean;
  className?: string;
}) {
  return (
    <div
      data-streaming={streaming ? 'true' : 'false'}
      className={cn(styles.root, className)}
    >
      {children}
    </div>
  );
}
