/**
 * Mirrors what the agent runs into the session's terminal.
 *
 * The agent works on its own shell channel, which is what keeps its output framed and its
 * working directory separate from yours — but it also means the terminal shows nothing
 * while it works, and watching a build scroll is exactly what a terminal is for. So the
 * command and its output are echoed here.
 *
 * This is display only. Nothing written this way reaches the server, and the agent's
 * channel is unaffected; it is the same as output from a background job arriving while
 * you have a prompt open.
 */

const EVENT = 'terminal-echo';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

type Rgb = [red: number, green: number, blue: number];

function cssHslToRgb(value: string, fallback: Rgb): Rgb {
  const match = value.trim().match(/^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) return fallback;

  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const saturation = Math.min(1, Math.max(0, Number(match[2]) / 100));
  const lightness = Math.min(1, Math.max(0, Number(match[3]) / 100));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = lightness - chroma / 2;
  let channels: Rgb;

  if (hue < 60) channels = [chroma, secondary, 0];
  else if (hue < 120) channels = [secondary, chroma, 0];
  else if (hue < 180) channels = [0, chroma, secondary];
  else if (hue < 240) channels = [0, secondary, chroma];
  else if (hue < 300) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  return channels.map(channel => Math.round((channel + offset) * 255)) as Rgb;
}

function themeAnsi(variable: '--primary' | '--primary-foreground', layer: 38 | 48, fallback: Rgb) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
  const [red, green, blue] = cssHslToRgb(value, fallback);
  return `\x1b[${layer};2;${red};${green};${blue}m`;
}

export interface TerminalEchoDetail {
  connectionId: string;
  text: string;
}

function emit(connectionId: string, text: string) {
  window.dispatchEvent(new CustomEvent<TerminalEchoDetail>(EVENT, {
    detail: { connectionId, text },
  }));
}

/** xterm needs a carriage return for a real line break; a shell only sends the newline. */
function toTerminalNewlines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

export function echoAgentCommand(connectionId: string, command: string) {
  const oneLine = command.replace(/\s*\n\s*/g, ' ; ');
  const accent = themeAnsi('--primary', 38, [132, 204, 22]);
  const badge = `${themeAnsi('--primary-foreground', 38, [12, 15, 10])}${themeAnsi('--primary', 48, [132, 204, 22])}`;
  emit(
    connectionId,
    `\r\n${badge}${BOLD} REFLEX ${RESET} ${accent}›${RESET} ${DIM}${oneLine}${RESET}\r\n`,
  );
}

export function echoAgentOutput(connectionId: string, chunk: string) {
  emit(connectionId, toTerminalNewlines(chunk));
}

export function echoAgentResult(connectionId: string, isError: boolean) {
  const colour = isError ? RED : '';
  emit(connectionId, `${DIM}${colour}▍${isError ? 'failed' : 'done'}${RESET}\r\n`);
}

export function subscribeTerminalEcho(
  connectionId: string,
  write: (text: string) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TerminalEchoDetail>).detail;
    if (detail?.connectionId === connectionId) write(detail.text);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
