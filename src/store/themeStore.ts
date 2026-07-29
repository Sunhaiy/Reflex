import { create } from 'zustand';
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
  setAppearance: (appearance: AppearanceMode) => void;
  setAccentColor: (accent: AccentColorId) => void;
  setOpacity: (opacity: number) => void;
  initTheme: () => Promise<void>;
}

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
  root.style.setProperty('--glow', accent.color);
}

function normalizeAppearance(value: unknown, legacyTheme: unknown): AppearanceMode {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  if (typeof legacyTheme === 'string') {
    const legacyLightThemes = ['light', 'coolWhite', 'taxue', 'lihua', 'aurora', 'ocean', 'sunset', 'twilight', 'blossom'];
    return legacyLightThemes.includes(legacyTheme) ? 'light' : 'dark';
  }
  return 'dark';
}

let mediaListenerAttached = false;

export const useThemeStore = create<ThemeState>((set, get) => ({
  appearance: 'dark',
  resolvedAppearance: 'dark',
  accentColorId: 'blue',
  terminalTheme: terminalThemes.dark,
  opacity: 1,

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
    void window.electron.storeSet('opacity', normalized);
  },

  initTheme: async () => {
    const [savedAppearance, legacyTheme, savedAccent, savedOpacity] = await Promise.all([
      window.electron.storeGet('appearance'),
      window.electron.storeGet('baseTheme'),
      window.electron.storeGet('accentColor'),
      window.electron.storeGet('opacity'),
    ]);

    const appearance = normalizeAppearance(savedAppearance, legacyTheme);
    const accentColorId = typeof savedAccent === 'string' && savedAccent in accentColors
      ? savedAccent as AccentColorId
      : 'blue';
    const resolvedAppearance = resolveAppearance(appearance);
    const opacity = typeof savedOpacity === 'number' && Number.isFinite(savedOpacity)
      ? Math.min(1, Math.max(0.88, savedOpacity))
      : 1;

    applyAppearance(resolvedAppearance, accentColorId);
    document.documentElement.style.setProperty('--app-opacity', String(opacity));
    set({
      appearance,
      resolvedAppearance,
      accentColorId,
      terminalTheme: terminalThemes[resolvedAppearance],
      opacity,
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
