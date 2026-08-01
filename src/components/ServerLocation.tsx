import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

interface ServerLocationProps {
  /** IANA zone reported by the server, e.g. "Asia/Shanghai". Empty when it has none. */
  timezone: string;
}

const COLLAPSED_HEIGHT = 88;
const EXPANDED_HEIGHT = 208;

/** "Asia/Shanghai" -> { city: 'Shanghai', region: 'Asia' } */
function splitZone(timezone: string) {
  const parts = timezone.split('/');
  return {
    region: parts[0]?.replace(/_/g, ' ') ?? '',
    city: (parts[parts.length - 1] ?? '').replace(/_/g, ' '),
  };
}

/** The server's own wall clock, derived from its zone — no request leaves this machine. */
function localTimeIn(timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '';
  }
}

/** Roads drawn on expand. `pathLength=1` lets one dash length drive every line. */
const ROADS = {
  main: [
    { x1: '0%', y1: '35%', x2: '100%', y2: '35%', width: 4, opacity: 0.25, delay: 200 },
    { x1: '0%', y1: '65%', x2: '100%', y2: '65%', width: 4, opacity: 0.25, delay: 300 },
    { x1: '30%', y1: '0%', x2: '30%', y2: '100%', width: 3, opacity: 0.2, delay: 400 },
    { x1: '70%', y1: '0%', x2: '70%', y2: '100%', width: 3, opacity: 0.2, delay: 500 },
  ],
  minor: [
    ...[20, 50, 80].map((y, i) => ({
      x1: '0%', y1: `${y}%`, x2: '100%', y2: `${y}%`, width: 1.5, opacity: 0.1, delay: 600 + i * 100,
    })),
    ...[15, 45, 55, 85].map((x, i) => ({
      x1: `${x}%`, y1: '0%', x2: `${x}%`, y2: '100%', width: 1.5, opacity: 0.1, delay: 700 + i * 100,
    })),
  ],
};

const BUILDINGS = [
  { top: '40%', left: '10%', width: '15%', height: '20%', alpha: 0.3, delay: 500 },
  { top: '15%', left: '35%', width: '12%', height: '15%', alpha: 0.25, delay: 600 },
  { top: '70%', left: '75%', width: '18%', height: '18%', alpha: 0.28, delay: 700 },
  { top: '20%', left: '80%', width: '10%', height: '25%', alpha: 0.22, delay: 550 },
  { top: '55%', left: '5%', width: '8%', height: '12%', alpha: 0.2, delay: 650 },
  { top: '8%', left: '62%', width: '14%', height: '10%', alpha: 0.22, delay: 750 },
];

/**
 * Where the server thinks it is, read from its timezone over the SSH session already
 * open — nothing is sent to a geolocation service. The map is deliberately a schematic,
 * not a real one: without a lookup there are no coordinates to plot, and drawing a
 * plausible-looking real map would be inventing data.
 *
 * Ported from a framer-motion original; the tilt, the size change, the road draw-on and
 * the staggered buildings are all CSS here, so no animation dependency is pulled in.
 */
export function ServerLocation({ timezone }: ServerLocationProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(() => (timezone ? localTimeIn(timezone) : ''));
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!timezone) {
      setNow('');
      return;
    }
    setNow(localTimeIn(timezone));
    const timer = setInterval(() => setNow(localTimeIn(timezone)), 30_000);
    return () => clearInterval(timer);
  }, [timezone]);

  const { region, city } = splitZone(timezone);
  const known = Boolean(timezone);

  const handleMove = (event: React.MouseEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    setTilt({ x: Math.max(-1, Math.min(1, dy)) * -6, y: Math.max(-1, Math.min(1, dx)) * 6 });
  };

  return (
    <div className="relative pb-4" style={{ perspective: '900px' }}>
      <div
        ref={cardRef}
        onMouseMove={handleMove}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setTilt({ x: 0, y: 0 });
          setHovered(false);
        }}
        onClick={() => known && setExpanded((value) => !value)}
        className={cn(
          'relative select-none overflow-hidden rounded-xl border border-border/55 bg-card/35',
          'transition-[transform,height] duration-500 ease-out',
          known && 'cursor-pointer',
        )}
        style={{
          height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        }}
      >
        {/* Faint grid while collapsed, replaced by the schematic when open. */}
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: expanded ? 0 : 0.04,
            backgroundImage:
              'linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px),'
              + ' linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />

        {expanded && (
          <div className="pointer-events-none absolute inset-0 animate-in fade-in duration-500">
            <div className="absolute inset-0 bg-muted/60" />

            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
              {[...ROADS.main, ...ROADS.minor].map((road, index) => (
                <line
                  key={index}
                  x1={road.x1}
                  y1={road.y1}
                  x2={road.x2}
                  y2={road.y2}
                  pathLength={1}
                  stroke="hsl(var(--foreground))"
                  strokeOpacity={road.opacity}
                  strokeWidth={road.width}
                  className="road-draw"
                  style={{ animationDelay: `${road.delay}ms` }}
                />
              ))}
            </svg>

            {BUILDINGS.map((building, index) => (
              <div
                key={index}
                className="absolute rounded-sm border animate-in fade-in-0 zoom-in-90 fill-mode-backwards duration-500"
                style={{
                  top: building.top,
                  left: building.left,
                  width: building.width,
                  height: building.height,
                  backgroundColor: `hsl(var(--muted-foreground) / ${building.alpha})`,
                  borderColor: `hsl(var(--muted-foreground) / ${building.alpha * 0.6})`,
                  animationDelay: `${building.delay}ms`,
                }}
              />
            ))}

            {/* Pin marks the middle of the schematic, not a surveyed position. */}
            <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 animate-in fade-in-0 zoom-in-50 fill-mode-backwards duration-500 [animation-delay:300ms]">
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                style={{ filter: 'drop-shadow(0 0 10px rgba(52, 211, 153, 0.5))' }}
              >
                <path
                  d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                  fill="#34D399"
                />
                <circle cx="12" cy="9" r="2.5" className="fill-background" />
              </svg>
            </div>

            <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent opacity-70" />
          </div>
        )}

        <div className="relative flex h-full flex-col justify-between p-3">
          <div className="flex items-start justify-between gap-2">
            {/* Map glyph, hidden once the schematic itself is showing. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-emerald-500 transition-all duration-300"
              style={{
                opacity: expanded ? 0 : 1,
                filter: hovered
                  ? 'drop-shadow(0 0 8px rgba(52, 211, 153, 0.6))'
                  : 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.3))',
              }}
            >
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
              <line x1="9" x2="9" y1="3" y2="18" />
              <line x1="15" x2="15" y1="6" y2="21" />
            </svg>

            {known && now && (
              <div
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-1',
                  'backdrop-blur-sm transition-transform duration-200',
                  hovered && 'scale-105 bg-foreground/[0.08]',
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  {now}
                </span>
              </div>
            )}
          </div>

          {known && (
            <div className="space-y-1">
              <h3
                className="truncate text-sm font-medium tracking-tight transition-transform duration-300"
                style={{ transform: hovered ? 'translateX(4px)' : 'none' }}
              >
                {city}
              </h3>

              <div
                className="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300"
                style={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
              >
                <div className="min-h-0 font-mono text-[10px] leading-4 text-muted-foreground">
                  {timezone}
                  <span className="ml-1.5 opacity-70">· {region}</span>
                </div>
              </div>

              <div
                className="h-px origin-left bg-gradient-to-r from-emerald-500/50 via-emerald-400/30 to-transparent transition-transform duration-500 ease-out"
                style={{ transform: `scaleX(${hovered || expanded ? 1 : 0.3})` }}
              />
            </div>
          )}
        </div>
      </div>

      <p
        className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[9px] text-muted-foreground transition-all duration-200"
        style={{
          opacity: known && hovered && !expanded ? 1 : 0,
          transform: hovered ? 'none' : 'translateY(4px)',
        }}
      >
        {t('monitor.locationExpandHint')}
      </p>
    </div>
  );
}
