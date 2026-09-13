import { cn } from '../lib/utils';
import styles from './ReflexLogo.module.css';

/** The suxins-life mark, split into strokes for its tailoring-inspired entrance. */
export function ReflexLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn(styles.logo, 'shrink-0 text-foreground', className)}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <path className={styles.outline} pathLength="1" d="M6.002 4c-1.553.047-2.48.22-3.121.861-.879.879-.879 2.293-.879 5.121L1.998 16c0 2.829 0 4.243.878 5.121C3.755 22 5.169 22 7.998 22h8c2.828 0 4.242 0 5.121-.879.879-.878.879-2.293.879-5.121l.004-6.017c0-2.829 0-4.243-.878-5.122C20.482 4.22 19.556 4.047 18.002 4" />
        <g className={styles.collar}>
          <path d="m17.998 4-1.06 2.04c-1.001 1.892-1.501 2.839-2.255 2.945a1.706 1.706 0 0 1-.393.003C13.535 8.89 13.023 7.879 11.998 6l4-4 2 2Z" />
          <path d="m5.998 4 1.059 2.04c1.001 1.892 1.501 2.839 2.255 2.945.13.019.262.02.393.003C10.46 8.89 10.972 7.879 11.998 6l-4-4-2 2Z" />
        </g>
        <path className={styles.seams} pathLength="1" d="m17.998 4-3 18M5.998 4l3 18M15.998 2h-8" />
        <path className={styles.button} d="M12.125 12.75H12m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z" />
        <path className={cn(styles.button, styles.lastButton)} d="M12.125 16.75H12m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z" />
      </g>
    </svg>
  );
}
