
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

const curatedBaseThemes = ['coolBlack', 'coolWhite', 'blossom'] as const;
const curatedTerminalThemes = ['default', 'githubLight', 'taxuexunmei'] as const;

const getDefaultTerminalTheme = (baseThemeId: BaseThemeId): TerminalThemeId => {
  if (baseThemeId === 'coolWhite') {
    return 'githubLight';
  }

  if (baseThemeId === 'blossom') {
    return 'taxuexunmei';
  }

  return 'default';
};

const normalizeBaseThemeId = (themeId?: string | null): BaseThemeId => {
  if (!themeId || !baseThemes[themeId as BaseThemeId]) {
    return 'coolBlack';
  }

  if (curatedBaseThemes.includes(themeId as typeof curatedBaseThemes[number])) {
    return themeId as BaseThemeId;
  }

  if (themeId === 'taxue' || themeId === 'lihua') {
    return 'blossom';
  }

  return baseThemes[themeId as BaseThemeId].type === 'light' ? 'coolWhite' : 'coolBlack';
};

const normalizeTerminalThemeId = (themeId: unknown, baseThemeId: BaseThemeId): TerminalThemeId => {
  if (typeof themeId === 'string' && curatedTerminalThemes.includes(themeId as typeof curatedTerminalThemes[number])) {
    return themeId as TerminalThemeId;
  }

  if (typeof themeId === 'string' && terminalThemes[themeId as TerminalThemeId]) {
    const theme = terminalThemes[themeId as TerminalThemeId];

    if (themeId === 'taxuexunmei') {
      return 'taxuexunmei';
    }

    return theme.category === 'light' ? 'githubLight' : 'default';
  }

  return getDefaultTerminalTheme(baseThemeId);
};

// Helper to generate full theme colors
const generateThemeColors = (baseId: BaseThemeId, accentId: AccentColorId): ThemeColors => {
  const base = baseThemes[baseId];
  const accent = accentColors[accentId];

  return {
    ...base.colors,
    primary: base.colorOverrides?.primary ?? accent.color,
    primaryForeground: base.colorOverrides?.primaryForeground ?? accent.foreground,
    ring: base.colorOverrides?.ring ?? accent.color,
    // Use accent color for accent tokens as well for consistency in this design
    accent: base.colorOverrides?.accent ?? base.colors.secondary, // Keep secondary as accent background usually
    accentForeground: base.colorOverrides?.accentForeground ?? base.colors.secondaryForeground,

    // We can also make 'accent' token use the color if we want colored accents, 
    // but usually 'accent' in shadcn/tailwind is for hover states of list items.
    // Hoppscotch uses the primary color for active states.

    destructive: base.colorOverrides?.destructive ?? "0 84.2% 60.2%", // Standard red
    destructiveForeground: base.colorOverrides?.destructiveForeground ?? "0 0% 98%",
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
  baseThemeId: 'coolBlack',
  accentColorId: 'indigo',
  currentTerminalThemeId: 'default',

  theme: {
    type: 'dark',
    colors: generateThemeColors('coolBlack', 'indigo')
  },

  terminalTheme: terminalThemes['default'],
  opacity: 0.9,

  setBaseTheme: (id: BaseThemeId) => {
    set((state) => {
      const newColors = generateThemeColors(id, state.accentColorId);
      applyTheme(id, state.accentColorId);
      (window as any).electron.storeSet('baseTheme', id);

      // Auto-switch terminal theme to match light/dark mode
      const currentTerminalThemeId = normalizeTerminalThemeId(state.currentTerminalThemeId, id);
      const currentTermCat = terminalThemes[currentTerminalThemeId]?.category;
      const preferredTerminalThemeId = getDefaultTerminalTheme(id);
      const shouldSyncTerminalTheme =
        !curatedTerminalThemes.includes(currentTerminalThemeId as typeof curatedTerminalThemes[number]) ||
        currentTermCat !== baseThemes[id].type;

      if (shouldSyncTerminalTheme) {
        setTimeout(() => get().setTerminalTheme(preferredTerminalThemeId), 0);
      }

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
    let baseTheme: BaseThemeId = 'coolBlack';
    let accentColor: AccentColorId = 'indigo';

    // Legacy migration or load
    baseTheme = normalizeBaseThemeId(savedBaseTheme);

    if (savedAccentColor && accentColors[savedAccentColor]) {
      accentColor = savedAccentColor;
    }

    // Apply initial theme
    get().setBaseTheme(baseTheme);
    get().setAccentColor(accentColor);

    // Terminal Theme
    get().setTerminalTheme(normalizeTerminalThemeId(savedTerminalThemeId, baseTheme));

    // Opacity — default is now 1.0 (fully opaque). Reset old 0.9 default to 1.0.
    if (savedOpacity && parseFloat(savedOpacity) > 0.9) {
      get().setOpacity(parseFloat(savedOpacity));
    } else {
      get().setOpacity(1.0);
    }
  }
}));
