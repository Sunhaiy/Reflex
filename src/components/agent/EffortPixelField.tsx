import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

type Rgb = [number, number, number];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
  mix(from[2], to[2], amount),
];
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const position = clamp((value - edge0) / (edge1 - edge0));
  return position * position * (3 - 2 * position);
};
const noise = (seed: number) => Math.abs(Math.sin(seed) * 43758.5453) % 1;

function hslTokenToRgb(token: string, fallback: Rgb): Rgb {
  const match = token.trim().match(/(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!match) return fallback;

  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const saturation = clamp(Number(match[2]) / 100);
  const lightness = clamp(Number(match[3]) / 100);
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) [red, green] = [chroma, secondary];
  else if (segment < 2) [red, green] = [secondary, chroma];
  else if (segment < 3) [green, blue] = [chroma, secondary];
  else if (segment < 4) [green, blue] = [secondary, chroma];
  else if (segment < 5) [red, blue] = [secondary, chroma];
  else [red, blue] = [chroma, secondary];

  const offset = lightness - chroma / 2;
  return [(red + offset) * 255, (green + offset) * 255, (blue + offset) * 255];
}

function drawPixelField(
  canvas: HTMLCanvasElement,
  time: number,
  startedAt: number,
  reveal: number,
) {
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  const styles = getComputedStyle(canvas);
  const primary = hslTokenToRgb(styles.getPropertyValue('--primary'), [132, 204, 22]);
  const foreground = hslTokenToRgb(styles.getPropertyValue('--foreground'), [245, 245, 245]);
  const background = hslTokenToRgb(styles.getPropertyValue('--background'), [12, 12, 14]);
  const neutral = mixRgb(background, foreground, 0.16);
  const highlight = mixRgb(primary, foreground, 0.62);
  const peak = mixRgb(primary, foreground, 0.86);
  const tones: Rgb[] = [
    mixRgb(primary, background, 0.2),
    mixRgb(primary, background, 0.1),
    primary,
    mixRgb(primary, foreground, 0.1),
    mixRgb(primary, foreground, 0.2),
    mixRgb(primary, foreground, 0.3),
  ];

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const frontier = 1 - reveal;
  const cell = width < 280 ? 5 : 6;
  const gap = 1.1;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const elapsed = Math.max(0, time - startedAt);
  const rawFlow = elapsed / 4000;
  const flowCycle = Math.floor(rawFlow);
  const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);

  context.save();
  context.beginPath();
  context.roundRect(0, 0, width, height, 9);
  context.clip();

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cell;
      const y = row * cell;
      const normalizedX = (x + cell * 0.5) / width;
      const revealAlpha = smoothstep(frontier - 0.1, frontier + 0.07, normalizedX);
      if (revealAlpha <= 0.002) continue;

      const colorAmount = smoothstep(0.08, 0.88, normalizedX);
      const fieldIntensity = smoothstep(0.02, 0.34, normalizedX);
      const depth = smoothstep(0.32, 0.95, normalizedX);
      const baseHash = noise(column * 12.9898 + row * 78.233);
      const tempoHash = noise(column * 7.13 + row * 19.41);
      const phaseHash = noise(column * 31.17 + row * 11.93);
      const chromaHash = noise(column * 9.47 + row * 67.13);
      const period = 500 + tempoHash * 1500;
      const localTime = elapsed + phaseHash * period;
      const cycle = Math.floor(localTime / period);
      const cycleProgress = (localTime % period) / period;
      const cycleHash = noise(column * 17.17 + row * 41.73 + cycle * 13.11);
      const widthHash = noise(column * 5.37 + row * 29.11 + cycle * 7.43);
      const pulseCenter = 0.2 + cycleHash * 0.55;
      const pulseWidth = 0.09 + widthHash * 0.08;
      const pulseDistance = (cycleProgress - pulseCenter) / pulseWidth;
      const irregularFlicker = Math.exp(-pulseDistance * pulseDistance * 1.45)
        * (cycleHash > 0.12 ? 1 : 0.26);

      const flowCoordinate = (normalizedX + easedFlow) * 9;
      const flowIndex = Math.floor(flowCoordinate);
      const flowProgress = smoothstep(0, 1, flowCoordinate - flowIndex);
      const flowA = noise(flowIndex * 18.31 + row * 37.17);
      const flowB = noise((flowIndex + 1) * 18.31 + row * 37.17);
      const flowCluster = smoothstep(0.46, 0.84, mix(flowA, flowB, flowProgress));
      const wavePhase = (normalizedX + easedFlow + row * 0.06 + baseHash * 0.02)
        * Math.PI * 2;
      const wave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
      const directionalFlow = Math.max(flowCluster, wave * 0.62);
      const flowingFlicker = Math.max(
        irregularFlicker * (0.48 + directionalFlow * 0.58),
        directionalFlow * (0.38 + baseHash * 0.28),
      );
      const revealGlow = reveal < 0.995
        ? Math.exp(-((normalizedX - frontier) ** 2) / 0.012)
          * (1 - smoothstep(0.7, 1, reveal))
        : 0;
      const lightAmount = Math.max(flowingFlicker, revealGlow * (0.4 + baseHash * 0.4));
      const hottest = lightAmount > 0.68 && irregularFlicker > 0.3 && cycleHash > 0.48;
      const highlighted = lightAmount > 0.4 && irregularFlicker > 0.16 && cycleHash > 0.26;
      const highlightAmount = highlighted
        ? 0.97
        : clamp(lightAmount * (0.44 + cycleHash * 0.3), 0, 0.64);

      const toneDrift = baseHash * 0.28
        + depth * 0.28
        + cycleProgress * 0.38
        + easedFlow * 0.18
        + cycleHash * 0.2
        + Math.sin(elapsed * 0.00135 + phaseHash * Math.PI * 2) * 0.14;
      const tonePosition = (((toneDrift % 1) + 1) % 1) * tones.length;
      const toneIndex = Math.floor(tonePosition);
      const tone = mixRgb(
        tones[toneIndex],
        tones[(toneIndex + 1) % tones.length],
        tonePosition - toneIndex,
      );
      const chromaNudge = (chromaHash - 0.5) * 0.12 + depth * 0.12;
      const variedTone = mixRgb(tone, foreground, clamp(chromaNudge));
      const baseColor = mixRgb(neutral, variedTone, colorAmount);
      const color = hottest ? mixRgb(baseColor, peak, 0.95) : mixRgb(baseColor, highlight, highlightAmount);
      const opacity = highlighted || hottest
        ? revealAlpha * fieldIntensity
        : revealAlpha * fieldIntensity * clamp(0.7 + baseHash * 0.2 + flowingFlicker * 0.12);

      context.globalAlpha = opacity;
      context.fillStyle = `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;
      context.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
    }
  }

  context.restore();
  context.globalAlpha = 1;
}

/**
 * Top-tier pixel animation adapted for React and theme colours from
 * https://github.com/zanwei/claude-model-selector (MIT, copyright Zanwei Guo).
 */
export function EffortPixelField({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    let animationFrame = 0;
    let lastFrame = 0;
    const startedAt = performance.now();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * pixelRatio);
      canvas.height = Math.round(bounds.height * pixelRatio);
    };

    const render = (time: number) => {
      if (!active) {
        context?.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const reveal = reducedMotion.matches ? 1 : smoothstep(0, 1, (time - startedAt) / 1000);
      drawPixelField(canvas, time, startedAt, reveal);
    };

    const animate = (time: number) => {
      if (time - lastFrame >= 33) {
        lastFrame = time;
        render(time);
      }
      animationFrame = requestAnimationFrame(animate);
    };

    resize();
    render(reducedMotion.matches ? startedAt + 1000 : startedAt);
    if (active && !reducedMotion.matches) animationFrame = requestAnimationFrame(animate);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      render(performance.now());
    });
    resizeObserver.observe(canvas);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-200',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}
