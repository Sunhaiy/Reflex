export type FontCategory = 'sans' | 'mono' | 'serif';

export interface FontOption {
  label: string;
  value: string;
  category: FontCategory;
}

const chineseFallback = "'Noto Sans SC Variable', 'Microsoft YaHei UI', sans-serif";

export const UI_FONT_OPTIONS: FontOption[] = [
  { label: 'Geist', value: `'Geist Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Inter', value: `'Inter Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Noto Sans', value: `'Noto Sans Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Nunito Sans', value: `'Nunito Sans Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Figtree', value: `'Figtree Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Roboto', value: `'Roboto Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Raleway', value: `'Raleway Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'DM Sans', value: `'DM Sans Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Public Sans', value: `'Public Sans Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Outfit', value: `'Outfit Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Oxanium', value: `'Oxanium Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Instrument Sans', value: `'Instrument Sans Variable', ${chineseFallback}`, category: 'sans' },
  { label: 'Geist Mono', value: `'Geist Mono Variable', 'Cascadia Mono', monospace`, category: 'mono' },
  { label: 'JetBrains Mono', value: `'JetBrains Mono Variable', 'Cascadia Mono', monospace`, category: 'mono' },
  { label: 'Noto Serif', value: `'Noto Serif Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'Roboto Slab', value: `'Roboto Slab Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'Merriweather', value: `'Merriweather Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'Lora', value: `'Lora Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'Playfair Display', value: `'Playfair Display Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'EB Garamond', value: `'EB Garamond Variable', 'Noto Serif SC', serif`, category: 'serif' },
  { label: 'Instrument Serif', value: `'Instrument Serif', 'Noto Serif SC', serif`, category: 'serif' },
];

export const TERMINAL_FONT_OPTIONS: FontOption[] = [
  { label: 'Geist Mono', value: "'Geist Mono Variable', 'Cascadia Mono', Consolas, monospace", category: 'mono' },
  { label: 'JetBrains Mono', value: "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace", category: 'mono' },
  { label: 'Roboto Mono', value: "'Roboto Mono Variable', 'Cascadia Mono', Consolas, monospace", category: 'mono' },
  { label: 'Cascadia Mono', value: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace", category: 'mono' },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace", category: 'mono' },
];

export const DEFAULT_UI_FONT_STACK = UI_FONT_OPTIONS[0].value;
export const DEFAULT_TERMINAL_FONT_STACK = TERMINAL_FONT_OPTIONS[0].value;

// Kept as aliases so older imports and stored settings migrate cleanly.
export const HOPPSCOTCH_UI_FONT_STACK = DEFAULT_UI_FONT_STACK;
export const HOPPSCOTCH_MONO_FONT_STACK = DEFAULT_TERMINAL_FONT_STACK;

export function normalizeUiFont(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_UI_FONT_STACK;
  return UI_FONT_OPTIONS.some((font) => font.value === value) ? value : DEFAULT_UI_FONT_STACK;
}

export function normalizeTerminalFont(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_TERMINAL_FONT_STACK;
  return TERMINAL_FONT_OPTIONS.some((font) => font.value === value) ? value : DEFAULT_TERMINAL_FONT_STACK;
}
