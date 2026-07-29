import { create } from 'zustand';
import type { Language } from '../shared/locales';
import {
    DEFAULT_TERMINAL_FONT_STACK,
    DEFAULT_UI_FONT_STACK,
    normalizeTerminalFont,
    normalizeUiFont,
} from '../shared/fontStacks';

interface SettingsState {
    language: Language;
    uiFontFamily: string;
    terminalFontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    rendererType: 'canvas' | 'webgl';
    scrollback: number;
    brightBold: boolean;
    bellStyle: 'none' | 'visual' | 'sound';
    autoReconnect: boolean;
    bookmarks: string[];

    setLanguage: (language: Language) => void;
    setUiFontFamily: (font: string) => void;
    setTerminalFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLineHeight: (height: number) => void;
    setLetterSpacing: (spacing: number) => void;
    setCursorStyle: (style: 'block' | 'underline' | 'bar') => void;
    setCursorBlink: (blink: boolean) => void;
    setRendererType: (renderer: 'canvas' | 'webgl') => void;
    setScrollback: (lines: number) => void;
    setBrightBold: (enabled: boolean) => void;
    setBellStyle: (style: 'none' | 'visual' | 'sound') => void;
    setAutoReconnect: (enabled: boolean) => void;
    toggleBookmark: (path: string) => void;
    initSettings: () => Promise<void>;
}

function persist(key: string, value: unknown) {
    void window.electron.storeSet(key, value);
}

function normalizeSettingNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    step: number,
) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const clamped = Math.min(max, Math.max(min, value));
    const rounded = Math.round(clamped / step) * step;
    return Number(rounded.toFixed(4));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    language: 'en',
    uiFontFamily: DEFAULT_UI_FONT_STACK,
    terminalFontFamily: DEFAULT_TERMINAL_FONT_STACK,
    fontSize: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    rendererType: 'canvas',
    scrollback: 5000,
    brightBold: true,
    bellStyle: 'none',
    autoReconnect: false,
    bookmarks: [],

    setLanguage: (language) => {
        set({ language });
        persist('language', language);
    },
    setUiFontFamily: (uiFontFamily) => {
        set({ uiFontFamily });
        persist('uiFontFamily', uiFontFamily);
    },
    setTerminalFontFamily: (terminalFontFamily) => {
        set({ terminalFontFamily });
        persist('terminalFontFamily', terminalFontFamily);
    },
    setFontSize: (fontSize) => {
        const value = normalizeSettingNumber(fontSize, get().fontSize, 10, 24, 1);
        set({ fontSize: value });
        persist('fontSize', value);
    },
    setLineHeight: (lineHeight) => {
        const value = normalizeSettingNumber(lineHeight, get().lineHeight, 1, 2, 0.1);
        set({ lineHeight: value });
        persist('lineHeight', value);
    },
    setLetterSpacing: (letterSpacing) => {
        const value = normalizeSettingNumber(letterSpacing, get().letterSpacing, -5, 5, 0.5);
        set({ letterSpacing: value });
        persist('letterSpacing', value);
    },
    setCursorStyle: (cursorStyle) => {
        set({ cursorStyle });
        persist('cursorStyle', cursorStyle);
    },
    setCursorBlink: (cursorBlink) => {
        set({ cursorBlink });
        persist('cursorBlink', cursorBlink);
    },
    setRendererType: (rendererType) => {
        set({ rendererType });
        persist('rendererType', rendererType);
    },
    setScrollback: (scrollback) => {
        const value = normalizeSettingNumber(scrollback, get().scrollback, 1000, 100000, 1000);
        set({ scrollback: value });
        persist('scrollback', value);
    },
    setBrightBold: (brightBold) => {
        set({ brightBold });
        persist('brightBold', brightBold);
    },
    setBellStyle: (bellStyle) => {
        set({ bellStyle });
        persist('bellStyle', bellStyle);
    },
    setAutoReconnect: (autoReconnect) => {
        set({ autoReconnect });
        persist('autoReconnect', autoReconnect);
    },
    toggleBookmark: (path) => {
        const current = get().bookmarks;
        const bookmarks = current.includes(path)
            ? current.filter((bookmark) => bookmark !== path)
            : [...current, path];
        set({ bookmarks });
        persist('bookmarks', bookmarks);
    },

    initSettings: async () => {
        const [
            language,
            uiFontFamily,
            terminalFontFamily,
            fontSize,
            lineHeight,
            letterSpacing,
            cursorStyle,
            cursorBlink,
            rendererType,
            scrollback,
            brightBold,
            bellStyle,
            bookmarks,
            autoReconnect,
        ] = await Promise.all([
            window.electron.storeGet('language'),
            window.electron.storeGet('uiFontFamily'),
            window.electron.storeGet('terminalFontFamily'),
            window.electron.storeGet('fontSize'),
            window.electron.storeGet('lineHeight'),
            window.electron.storeGet('letterSpacing'),
            window.electron.storeGet('cursorStyle'),
            window.electron.storeGet('cursorBlink'),
            window.electron.storeGet('rendererType'),
            window.electron.storeGet('scrollback'),
            window.electron.storeGet('brightBold'),
            window.electron.storeGet('bellStyle'),
            window.electron.storeGet('bookmarks'),
            window.electron.storeGet('autoReconnect'),
        ]);

        set({
            language: (language as Language) || 'en',
            uiFontFamily: normalizeUiFont(uiFontFamily),
            terminalFontFamily: normalizeTerminalFont(terminalFontFamily),
            fontSize: normalizeSettingNumber(fontSize, 14, 10, 24, 1),
            lineHeight: normalizeSettingNumber(lineHeight, 1.2, 1, 2, 0.1),
            letterSpacing: normalizeSettingNumber(letterSpacing, 0, -5, 5, 0.5),
            cursorStyle: (cursorStyle as SettingsState['cursorStyle']) || 'block',
            cursorBlink: typeof cursorBlink === 'boolean' ? cursorBlink : true,
            rendererType: (rendererType as SettingsState['rendererType']) || 'canvas',
            scrollback: normalizeSettingNumber(scrollback, 5000, 1000, 100000, 1000),
            brightBold: typeof brightBold === 'boolean' ? brightBold : true,
            bellStyle: (bellStyle as SettingsState['bellStyle']) || 'none',
            bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
            autoReconnect: typeof autoReconnect === 'boolean' ? autoReconnect : false,
        });

    },
}));
