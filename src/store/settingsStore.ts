import { create } from 'zustand';
import { Language } from '../shared/locales';
import { AIProvider, AIConfig, AI_PROVIDER_CONFIGS } from '../shared/aiTypes';
import { aiService } from '../services/aiService';

interface SettingsState {
    language: Language;
    uiFontFamily: string;
    terminalFontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    // Advanced Rendering
    rendererType: 'canvas' | 'webgl';
    scrollback: number;
    brightBold: boolean;
    // Sound
    bellStyle: 'none' | 'visual' | 'sound';

    // AI Settings
    aiProvider: AIProvider;
    aiApiKey: string;
    aiBaseUrl: string;
    aiModel: string;
    aiPrivacyMode: boolean;

    setLanguage: (lang: Language) => void;
    setUiFontFamily: (font: string) => void;
    setTerminalFontFamily: (font: string) => void;
    setFontSize: (size: number) => void;
    setLineHeight: (height: number) => void;
    setLetterSpacing: (spacing: number) => void;
    setCursorStyle: (style: 'block' | 'underline' | 'bar') => void;
    setCursorBlink: (blink: boolean) => void;

    // Advanced Actions
    setRendererType: (type: 'canvas' | 'webgl') => void;
    setScrollback: (lines: number) => void;
    setBrightBold: (enabled: boolean) => void;
    setBellStyle: (style: 'none' | 'visual' | 'sound') => void;

    // AI Actions
    setAiProvider: (provider: AIProvider) => void;
    setAiApiKey: (key: string) => void;
    setAiBaseUrl: (url: string) => void;
    setAiModel: (model: string) => void;
    setAiPrivacyMode: (enabled: boolean) => void;

    initSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    language: 'en',
    uiFontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    terminalFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,

    // Defaults
    rendererType: 'canvas',
    scrollback: 5000,
    brightBold: true,
    bellStyle: 'none',

    // AI Defaults
    aiProvider: 'deepseek',
    aiApiKey: '',
    aiBaseUrl: '',
    aiModel: '',
    aiPrivacyMode: false,

    setLanguage: (lang: Language) => {
        set({ language: lang });
        window.electron.storeSet('language', lang);
    },

    setUiFontFamily: (font: string) => {
        set({ uiFontFamily: font });
        window.electron.storeSet('uiFontFamily', font);
    },

    setTerminalFontFamily: (font: string) => {
        set({ terminalFontFamily: font });
        window.electron.storeSet('terminalFontFamily', font);
    },

    setFontSize: (size: number) => {
        set({ fontSize: size });
        window.electron.storeSet('fontSize', size);
    },

    setLineHeight: (height: number) => {
        set({ lineHeight: height });
        window.electron.storeSet('lineHeight', height);
    },

    setLetterSpacing: (spacing: number) => {
        set({ letterSpacing: spacing });
        window.electron.storeSet('letterSpacing', spacing);
    },

    setCursorStyle: (style: 'block' | 'underline' | 'bar') => {
        set({ cursorStyle: style });
        window.electron.storeSet('cursorStyle', style);
    },

    setCursorBlink: (blink: boolean) => {
        set({ cursorBlink: blink });
        window.electron.storeSet('cursorBlink', blink);
    },

    setRendererType: (type: 'canvas' | 'webgl') => {
        set({ rendererType: type });
        window.electron.storeSet('rendererType', type);
    },

    setScrollback: (lines: number) => {
        set({ scrollback: lines });
        window.electron.storeSet('scrollback', lines);
    },

    setBrightBold: (enabled: boolean) => {
        set({ brightBold: enabled });
        window.electron.storeSet('brightBold', enabled);
    },

    setBellStyle: (style: 'none' | 'visual' | 'sound') => {
        set({ bellStyle: style });
        window.electron.storeSet('bellStyle', style);
    },

    setAiProvider: (provider: AIProvider) => {
        set({ aiProvider: provider });
        window.electron.storeSet('aiProvider', provider);
        // Update AI service config
        const state = useSettingsStore.getState();
        aiService.setConfig({
            provider,
            apiKey: state.aiApiKey,
            baseUrl: state.aiBaseUrl || undefined,
            model: state.aiModel || undefined,
            privacyMode: state.aiPrivacyMode
        });
    },

    setAiApiKey: (key: string) => {
        set({ aiApiKey: key });
        window.electron.storeSet('aiApiKey', key);
        const state = useSettingsStore.getState();
        aiService.setConfig({
            provider: state.aiProvider,
            apiKey: key,
            baseUrl: state.aiBaseUrl || undefined,
            model: state.aiModel || undefined,
            privacyMode: state.aiPrivacyMode
        });
    },

    setAiBaseUrl: (url: string) => {
        set({ aiBaseUrl: url });
        window.electron.storeSet('aiBaseUrl', url);
    },

    setAiModel: (model: string) => {
        set({ aiModel: model });
        window.electron.storeSet('aiModel', model);
    },

    setAiPrivacyMode: (enabled: boolean) => {
        set({ aiPrivacyMode: enabled });
        window.electron.storeSet('aiPrivacyMode', enabled);
        const state = useSettingsStore.getState();
        aiService.setConfig({
            provider: state.aiProvider,
            apiKey: state.aiApiKey,
            baseUrl: state.aiBaseUrl || undefined,
            model: state.aiModel || undefined,
            privacyMode: enabled
        });
    },

    initSettings: async () => {
        const savedLang = await window.electron.storeGet('language');
        const savedUiFont = await window.electron.storeGet('uiFontFamily');
        const savedTerminalFont = await window.electron.storeGet('terminalFontFamily');
        // Fallback for migration: check old 'fontFamily' key if new key missing (optional, but good practice)
        const oldFontFamily = await window.electron.storeGet('fontFamily');

        const savedFontSize = await window.electron.storeGet('fontSize');
        const savedLineHeight = await window.electron.storeGet('lineHeight');
        const savedLetterSpacing = await window.electron.storeGet('letterSpacing');
        const savedCursorStyle = await window.electron.storeGet('cursorStyle');
        const savedCursorBlink = await window.electron.storeGet('cursorBlink');

        const savedRendererType = await window.electron.storeGet('rendererType');
        const savedScrollback = await window.electron.storeGet('scrollback');
        const savedBrightBold = await window.electron.storeGet('brightBold');
        const savedBellStyle = await window.electron.storeGet('bellStyle');

        set({
            language: (savedLang as Language) || 'en',
            uiFontFamily: (savedUiFont as string) || "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            terminalFontFamily: (savedTerminalFont as string) || (oldFontFamily as string) || "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: (savedFontSize as number) || 14,
            lineHeight: (savedLineHeight as number) || 1.2,
            letterSpacing: (savedLetterSpacing as number) || 0,
            cursorStyle: (savedCursorStyle as 'block' | 'underline' | 'bar') || 'block',
            cursorBlink: typeof savedCursorBlink === 'boolean' ? savedCursorBlink : true,

            rendererType: (savedRendererType as 'canvas' | 'webgl') || 'canvas',
            scrollback: (savedScrollback as number) || 5000,
            brightBold: typeof savedBrightBold === 'boolean' ? savedBrightBold : true,
            bellStyle: (savedBellStyle as 'none' | 'visual' | 'sound') || 'none',
        });

        // Load AI settings
        const savedAiProvider = await window.electron.storeGet('aiProvider');
        const savedAiApiKey = await window.electron.storeGet('aiApiKey');
        const savedAiBaseUrl = await window.electron.storeGet('aiBaseUrl');
        const savedAiModel = await window.electron.storeGet('aiModel');
        const savedAiPrivacyMode = await window.electron.storeGet('aiPrivacyMode');

        const aiProvider = (savedAiProvider as AIProvider) || 'deepseek';
        const aiApiKey = (savedAiApiKey as string) || '';
        const aiBaseUrl = (savedAiBaseUrl as string) || '';
        const aiModel = (savedAiModel as string) || '';
        const aiPrivacyMode = typeof savedAiPrivacyMode === 'boolean' ? savedAiPrivacyMode : false;

        set({ aiProvider, aiApiKey, aiBaseUrl, aiModel, aiPrivacyMode });

        // Initialize AI service
        if (aiApiKey) {
            aiService.setConfig({
                provider: aiProvider,
                apiKey: aiApiKey,
                baseUrl: aiBaseUrl || undefined,
                model: aiModel || undefined,
                privacyMode: aiPrivacyMode
            });
        }
    }
}));
