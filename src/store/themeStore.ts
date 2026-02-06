import { create } from 'zustand';
import { Theme, ThemeId, themes, TerminalTheme, TerminalThemeId, terminalThemes } from '../shared/themes';

interface ThemeState {
  currentThemeId: ThemeId;
  currentTerminalThemeId: TerminalThemeId;
  theme: Theme;
  terminalTheme: TerminalTheme;
  opacity: number;
  setTheme: (id: ThemeId) => void;
  setTerminalTheme: (id: TerminalThemeId) => void;
  setOpacity: (opacity: number) => void;
  initTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentThemeId: 'zangqing',
  currentTerminalThemeId: 'zangqing',
  theme: themes['zangqing'],
  terminalTheme: terminalThemes['zangqing'],
  opacity: 0.9,

  setTheme: (id: ThemeId) => {
    const theme = themes[id];
    set({ currentThemeId: id, theme });

    // Apply CSS variables
    const root = document.documentElement;

    // Set class for dark/light mode for Tailwind
    if (theme.type === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Set CSS variables
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });

    // Persist
    (window as any).electron.storeSet('theme', id);
  },

  setTerminalTheme: (id: TerminalThemeId) => {
    const terminalTheme = terminalThemes[id];
    set({ currentTerminalThemeId: id, terminalTheme });
    (window as any).electron.storeSet('terminalTheme', id);
  },

  setOpacity: (opacity: number) => {
    set({ opacity });
    const root = document.getElementById('root');
    if (root) {
      root.style.setProperty('--app-opacity', opacity.toString());
    }
    (window as any).electron.storeSet('opacity', opacity);
  },

  initTheme: async () => {
    const savedThemeId = await (window as any).electron.storeGet('theme');
    const savedTerminalThemeId = await (window as any).electron.storeGet('terminalTheme');
    const savedOpacity = await (window as any).electron.storeGet('opacity');

    if (savedOpacity) {
      set({ opacity: parseFloat(savedOpacity) });
      const root = document.getElementById('root');
      if (root) {
        root.style.setProperty('--app-opacity', savedOpacity.toString());
      }
    } else {
      const root = document.getElementById('root');
      if (root) {
        root.style.setProperty('--app-opacity', '0.9');
      }
    }

    if (savedThemeId && themes[savedThemeId as ThemeId]) {
      get().setTheme(savedThemeId as ThemeId);
    } else {
      // Default to zangqing
      get().setTheme('zangqing');
    }

    if (savedTerminalThemeId && terminalThemes[savedTerminalThemeId as TerminalThemeId]) {
      get().setTerminalTheme(savedTerminalThemeId as TerminalThemeId);
    } else {
      // Use zangqing terminal theme
      get().setTerminalTheme('zangqing');
    }
  }
}));
