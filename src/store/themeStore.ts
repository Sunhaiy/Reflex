import { create } from 'zustand';
import { Theme, ThemeId, themes } from '../shared/themes';

interface ThemeState {
  currentThemeId: ThemeId;
  theme: Theme;
  opacity: number;
  setTheme: (id: ThemeId) => void;
  setOpacity: (opacity: number) => void;
  initTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentThemeId: 'dark',
  theme: themes['dark'],
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
      // Default to dark
      get().setTheme('dark');
    }
  }
}));
