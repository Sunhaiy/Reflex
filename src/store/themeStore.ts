import { create } from 'zustand';
import type { StoreKey } from '../shared/storeKeys';
import {
  accentColors,
  type AccentColorId,
  type AppearanceMode,
  type ResolvedAppearance,
  type TerminalTheme,
  terminalThemes,
} from '../shared/themes';

interface ThemeState {
  appearance: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  accentColorId: AccentColorId;
  terminalTheme: TerminalTheme;
  opacity: number;
  radiusScale: number;
  setAppearance: (appearance: AppearanceMode) => void;
  setAccentColor: (accent: AccentColorId) => void;
  setOpacity: (opacity: number) => void;
  setRadiusScale: (radiusScale: number) => void;
  initTheme: () => Promise<void>;
}

export const MIN_RADIUS_SCALE = 0;
export const MAX_RADIUS_SCALE = 1.6;

function clampRadiusScale(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(MAX_RADIUS_SCALE, Math.max(MIN_RADIUS_SCALE, value));
}

// Dragging a slider fires an event per pixel; persisting each one floods the IPC
// channel and makes the drag stutter. The CSS variable still updates immediately.
function debouncePersist<T>(key: StoreKey, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (value: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void window.electron.storeSet(key, value);
    }, delay);
  };
}

const persistRadiusScale = debouncePersist<number>('radiusScale');
const persistOpacity = debouncePersist<number>('opacity');

function systemAppearance(): ResolvedAppearance {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveAppearance(appearance: AppearanceMode): ResolvedAppearance {
  return appearance === 'system' ? systemAppearance() : appearance;
}

function applyAppearance(resolved: ResolvedAppearance, accentId: AccentColorId) {
  const root = document.documentElement;
  const accent = accentColors[accentId];
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.appearance = resolved;
  root.style.setProperty('--primary', accent.color);
  root.style.setProperty('--primary-foreground', accent.foreground);
  root.style.setProperty('--ring', accent.color);
}

function normalizeAppearance(value: unknown, legacyTheme: unknown): AppearanceMode {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  if (typeof legacyTheme === 'string') {
    const legacyLightThemes = ['light', 'coolWhite', 'taxue', 'lihua', 'aurora', 'ocean', 'sunset', 'twilight', 'blossom'];
    return legacyLightThemes.includes(legacyTheme) ? 'light' : 'dark';
  }
  return 'light';
}

let mediaListenerAttached = false;

export const useThemeStore = create<ThemeState>((set, get) => ({
  appearance: 'light',
  resolvedAppearance: 'light',
  accentColorId: 'lime',
  terminalTheme: terminalThemes.light,
  opacity: 1,
  radiusScale: 1,

  setAppearance: (appearance) => {
    const resolvedAppearance = resolveAppearance(appearance);
    applyAppearance(resolvedAppearance, get().accentColorId);
    set({ appearance, resolvedAppearance, terminalTheme: terminalThemes[resolvedAppearance] });
    void window.electron.storeSet('appearance', appearance);
  },

  setAccentColor: (accentColorId) => {
    applyAppearance(get().resolvedAppearance, accentColorId);
    set({ accentColorId });
    void window.electron.storeSet('accentColor', accentColorId);
  },

  setOpacity: (opacity) => {
    const normalized = Math.min(1, Math.max(0.88, opacity));
    document.documentElement.style.setProperty('--app-opacity', String(normalized));
    set({ opacity: normalized });
    persistOpacity(normalized);
  },

  setRadiusScale: (radiusScale) => {
    const normalized = clampRadiusScale(radiusScale);
    if (get().radiusScale === normalized) return;
    document.documentElement.style.setProperty('--radius-scale', String(normalized));
    set({ radiusScale: normalized });
    persistRadiusScale(normalized);
  },

  initTheme: async () => {
    const [savedAppearance, legacyTheme, savedAccent, savedOpacity, savedRadiusScale] = await Promise.all([
      window.electron.storeGet('appearance'),
      window.electron.storeGet('baseTheme'),
      window.electron.storeGet('accentColor'),
      window.electron.storeGet('opacity'),
      window.electron.storeGet('radiusScale'),
    ]);

    const appearance = normalizeAppearance(savedAppearance, legacyTheme);
    const accentColorId = typeof savedAccent === 'string' && savedAccent in accentColors
      ? savedAccent as AccentColorId
      : 'lime';
    const resolvedAppearance = resolveAppearance(appearance);
    const opacity = typeof savedOpacity === 'number' && Number.isFinite(savedOpacity)
      ? Math.min(1, Math.max(0.88, savedOpacity))
      : 1;

    const radiusScale = clampRadiusScale(savedRadiusScale);

    applyAppearance(resolvedAppearance, accentColorId);
    document.documentElement.style.setProperty('--app-opacity', String(opacity));
    document.documentElement.style.setProperty('--radius-scale', String(radiusScale));
    set({
      appearance,
      resolvedAppearance,
      accentColorId,
      terminalTheme: terminalThemes[resolvedAppearance],
      opacity,
      radiusScale,
    });

    if (!mediaListenerAttached) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const state = get();
        if (state.appearance !== 'system') return;
        const next = systemAppearance();
        applyAppearance(next, state.accentColorId);
        set({ resolvedAppearance: next, terminalTheme: terminalThemes[next] });
      });
      mediaListenerAttached = true;
    }
  },
}));
