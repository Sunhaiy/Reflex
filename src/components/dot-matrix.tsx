import type { ComponentProps, CSSProperties } from 'react';
import { cn } from '../lib/utils';

const GRID = 5;
const CENTER = (GRID - 1) / 2;
const DOT_INDEXES = Array.from({ length: GRID * GRID }, (_, index) => index);

const DOT_MATRIX_CSS =
  '@property --aui-dot-matrix-hi{syntax:"<number>";inherits:false;initial-value:1}'
  + '@property --aui-dot-matrix-lo{syntax:"<number>";inherits:false;initial-value:0.2}'
  + '@keyframes aui-dot-matrix-blink{0%,100%{opacity:var(--aui-dot-matrix-hi,1)}'
  + '50%{opacity:var(--aui-dot-matrix-lo,0.2)}}';

export type DotMatrixProps = Omit<ComponentProps<'span'>, 'children'> & {
  state?: 'syncing';
  label?: string;
};

/** assistant-ui's monochrome 5x5 syncing sweep, adapted for React 18. */
export function DotMatrix({
  className,
  state = 'syncing',
  label,
  ...props
}: DotMatrixProps) {
  return (
    <span
      data-slot="dot-matrix"
      data-state={state}
      role="status"
      className={cn('inline-block size-4 shrink-0', className)}
      {...props}
    >
      <span className="sr-only">{label ?? state}</span>
      <style>{DOT_MATRIX_CSS}</style>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="size-full"
      >
        {DOT_INDEXES.map((index) => {
          const row = Math.floor(index / GRID);
          const column = index % GRID;
          const turn = (
            Math.atan2(row - CENTER, column - CENTER) + Math.PI
          ) / (2 * Math.PI);

          return (
            <circle
              key={index}
              data-slot="dot-matrix-dot"
              cx={2 + column * 4}
              cy={2 + row * 4}
              r={1.3}
              className="[animation-iteration-count:infinite] [animation-name:aui-dot-matrix-blink] [animation-timing-function:ease-in-out] motion-reduce:[animation-name:none]"
              style={{
                opacity: 1,
                animationDuration: '1.3s',
                animationDelay: `${-turn * 1.3}s`,
                '--aui-dot-matrix-hi': 1,
                '--aui-dot-matrix-lo': 0.2,
              } as CSSProperties}
            />
          );
        })}
      </svg>
    </span>
  );
}
