import { create } from 'zustand';
import type { Language } from '../shared/locales';
import {
    HOPPSCOTCH_MONO_FONT_STACK,
    HOPPSCOTCH_UI_FONT_STACK,
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
    language: 'en',
    uiFontFamily: HOPPSCOTCH_UI_FONT_STACK,
    terminalFontFamily: HOPPSCOTCH_MONO_FONT_STACK,
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
        set({ fontSize });
        persist('fontSize', fontSize);
    },
    setLineHeight: (lineHeight) => {
        set({ lineHeight });
        persist('lineHeight', lineHeight);
    },
    setLetterSpacing: (letterSpacing) => {
        set({ letterSpacing });
        persist('letterSpacing', letterSpacing);
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
        set({ scrollback });
        persist('scrollback', scrollback);
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
            uiFontFamily: HOPPSCOTCH_UI_FONT_STACK,
            terminalFontFamily: HOPPSCOTCH_MONO_FONT_STACK,
            fontSize: typeof fontSize === 'number' ? fontSize : 14,
            lineHeight: typeof lineHeight === 'number' ? lineHeight : 1.2,
            letterSpacing: typeof letterSpacing === 'number' ? letterSpacing : 0,
            cursorStyle: (cursorStyle as SettingsState['cursorStyle']) || 'block',
            cursorBlink: typeof cursorBlink === 'boolean' ? cursorBlink : true,
            rendererType: (rendererType as SettingsState['rendererType']) || 'canvas',
            scrollback: typeof scrollback === 'number' ? scrollback : 5000,
            brightBold: typeof brightBold === 'boolean' ? brightBold : true,
            bellStyle: (bellStyle as SettingsState['bellStyle']) || 'none',
            bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
            autoReconnect: typeof autoReconnect === 'boolean' ? autoReconnect : false,
        });

        persist('uiFontFamily', HOPPSCOTCH_UI_FONT_STACK);
        persist('terminalFontFamily', HOPPSCOTCH_MONO_FONT_STACK);
    },
}));
