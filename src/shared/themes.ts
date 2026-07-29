export type AppearanceMode = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';

export type AccentColorId =
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'fuchsia'
  | 'green'
  | 'indigo'
  | 'lime'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'rose';

export interface AccentColor {
  id: AccentColorId;
  name: string;
  color: string;
  foreground: string;
}

export const accentColors: Record<AccentColorId, AccentColor> = {
  blue: { id: 'blue', name: 'Blue', color: '221 83% 53%', foreground: '0 0% 100%' },
  cyan: { id: 'cyan', name: 'Cyan', color: '189 94% 43%', foreground: '192 91% 8%' },
  emerald: { id: 'emerald', name: 'Emerald', color: '160 84% 39%', foreground: '0 0% 100%' },
  fuchsia: { id: 'fuchsia', name: 'Fuchsia', color: '292 84% 61%', foreground: '0 0% 100%' },
  green: { id: 'green', name: 'Green', color: '142 71% 45%', foreground: '0 0% 100%' },
  indigo: { id: 'indigo', name: 'Indigo', color: '239 84% 67%', foreground: '0 0% 100%' },
  lime: { id: 'lime', name: 'Lime', color: '84 81% 44%', foreground: '85 80% 8%' },
  orange: { id: 'orange', name: 'Orange', color: '25 95% 53%', foreground: '24 30% 8%' },
  pink: { id: 'pink', name: 'Pink', color: '330 81% 60%', foreground: '0 0% 100%' },
  purple: { id: 'purple', name: 'Purple', color: '271 81% 56%', foreground: '0 0% 100%' },
  red: { id: 'red', name: 'Red', color: '0 84% 60%', foreground: '0 0% 100%' },
  rose: { id: 'rose', name: 'Rose', color: '347 77% 50%', foreground: '0 0% 100%' },
};

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const terminalThemes: Record<ResolvedAppearance, TerminalTheme> = {
  dark: {
    background: '#09090b',
    foreground: '#e4e4e7',
    cursor: '#fafafa',
    selectionBackground: '#3f3f46',
    black: '#18181b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#d4d4d8',
    brightBlack: '#71717a',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#fafafa',
  },
  light: {
    background: '#fafafa',
    foreground: '#18181b',
    cursor: '#09090b',
    selectionBackground: '#d4d4d8',
    black: '#27272a',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#f4f4f5',
    brightBlack: '#52525b',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  },
};
