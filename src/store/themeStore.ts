
import { create } from 'zustand';
import {
  BaseThemeId,
  AccentColorId,
  TerminalTheme,
  TerminalThemeId,
  baseThemes,
  accentColors,
  terminalThemes,
  ThemeColors
} from '../shared/themes';

interface ThemeState {
  baseThemeId: BaseThemeId;
  accentColorId: AccentColorId;
  currentTerminalThemeId: TerminalThemeId;

  // Computed theme for compatibility and usage
  theme: {
    type: 'light' | 'dark';
    colors: ThemeColors;
  };

  terminalTheme: TerminalTheme;
  opacity: number;

  setBaseTheme: (id: BaseThemeId) => void;
  setAccentColor: (id: AccentColorId) => void;
  setTerminalTheme: (id: TerminalThemeId) => void;
  setOpacity: (opacity: number) => void;
  initTheme: () => Promise<void>;
}

// Helper to generate full theme colors
const generateThemeColors = (baseId: BaseThemeId, accentId: AccentColorId): ThemeColors => {
  const base = baseThemes[baseId];
  const accent = accentColors[accentId];

  return {
    ...base.colors,
    primary: accent.color,
    primaryForeground: accent.foreground,
    ring: accent.color,
    // Use accent color for accent tokens as well for consistency in this design
    accent: base.colors.secondary, // Keep secondary as accent background usually
    accentForeground: base.colors.secondaryForeground,

    // We can also make 'accent' token use the color if we want colored accents, 
    // but usually 'accent' in shadcn/tailwind is for hover states of list items.
    // Hoppscotch uses the primary color for active states.

    destructive: "0 84.2% 60.2%", // Standard red
    destructiveForeground: "0 0% 98%",
  };
};

// Helper to apply theme to DOM
const applyTheme = (baseId: BaseThemeId, accentId: AccentColorId) => {
  const root = document.documentElement;
  const base = baseThemes[baseId];
  const colors = generateThemeColors(baseId, accentId);

  // Set class for dark/light mode
  if (base.type === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Set CSS variables
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  baseThemeId: 'black',
  accentColorId: 'indigo',
  currentTerminalThemeId: 'default',

  theme: {
    type: 'dark',
    colors: generateThemeColors('black', 'indigo')
  },

  terminalTheme: terminalThemes['default'],
  opacity: 0.9,

  setBaseTheme: (id: BaseThemeId) => {
    set((state) => {
      const newColors = generateThemeColors(id, state.accentColorId);
      applyTheme(id, state.accentColorId);
      (window as any).electron.storeSet('baseTheme', id);
      return {
        baseThemeId: id,
        theme: {
          type: baseThemes[id].type,
          colors: newColors
        }
      };
    });
  },

  setAccentColor: (id: AccentColorId) => {
    set((state) => {
      const newColors = generateThemeColors(state.baseThemeId, id);
      applyTheme(state.baseThemeId, id);
      (window as any).electron.storeSet('accentColor', id);
      return {
        accentColorId: id,
        theme: {
          ...state.theme,
          colors: newColors
        }
      };
    });
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
    const savedBaseTheme = await (window as any).electron.storeGet('baseTheme') as BaseThemeId;
    const savedAccentColor = await (window as any).electron.storeGet('accentColor') as AccentColorId;
    const savedTerminalThemeId = await (window as any).electron.storeGet('terminalTheme');
    const savedOpacity = await (window as any).electron.storeGet('opacity');

    // Default values
    let baseTheme: BaseThemeId = 'black';
    let accentColor: AccentColorId = 'indigo';

    // Legacy migration or load
    if (savedBaseTheme && baseThemes[savedBaseTheme]) {
      baseTheme = savedBaseTheme;
    } else {
      // Try to migrate boolean dark mode or old theme names if necessary
      // For now, just default to dark/indigo which is close to Hoppscotch
    }

    if (savedAccentColor && accentColors[savedAccentColor]) {
      accentColor = savedAccentColor;
    }

    // Apply initial theme
    get().setBaseTheme(baseTheme);
    get().setAccentColor(accentColor);

    // Terminal Theme
    if (savedTerminalThemeId && terminalThemes[savedTerminalThemeId as TerminalThemeId]) {
      get().setTerminalTheme(savedTerminalThemeId as TerminalThemeId);
    } else {
      get().setTerminalTheme('default');
    }

    // Opacity
    if (savedOpacity) {
      get().setOpacity(parseFloat(savedOpacity));
    } else {
      get().setOpacity(0.9);
    }
  }
}));
