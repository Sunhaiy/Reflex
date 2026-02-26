import { create } from 'zustand';
import { Language } from '../shared/locales';
import { AIProvider, AIConfig, AI_PROVIDER_CONFIGS, AIProviderProfile } from '../shared/aiTypes';
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
    aiEnabled: boolean;
    aiProvider: AIProvider;
    aiApiKey: string;
    aiBaseUrl: string;
    aiModel: string;
    aiPrivacyMode: boolean;
    aiSendShortcut: 'enter' | 'ctrlEnter';
    agentControlMode: 'auto' | 'approval' | 'whitelist';
    agentWhitelist: string[];

    // Multi-provider profiles
    aiProfiles: AIProviderProfile[];
    activeProfileId: string;

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
    setAiEnabled: (enabled: boolean) => void;
    setAiProvider: (provider: AIProvider) => void;
    setAiApiKey: (key: string) => void;
    setAiBaseUrl: (url: string) => void;
    setAiModel: (model: string) => void;
    setAiPrivacyMode: (enabled: boolean) => void;
    setAiSendShortcut: (shortcut: 'enter' | 'ctrlEnter') => void;
    setAgentControlMode: (mode: 'auto' | 'approval' | 'whitelist') => void;
    setAgentWhitelist: (list: string[]) => void;

    // Profile CRUD
    addAiProfile: (profile: AIProviderProfile) => void;
    updateAiProfile: (profile: AIProviderProfile) => void;
    removeAiProfile: (id: string) => void;
    setActiveProfile: (id: string) => void;

    // Bookmarks
    bookmarks: string[];
    toggleBookmark: (path: string) => void;

    initSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    language: 'en',
    uiFontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    terminalFontFamily: "'Inter', monospace",
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
    aiEnabled: true,
    aiProvider: 'deepseek',
    aiApiKey: '',
    aiBaseUrl: '',
    aiModel: '',
    aiPrivacyMode: false,
    aiSendShortcut: 'ctrlEnter',
    agentControlMode: 'auto',
    agentWhitelist: ['ls', 'pwd', 'whoami', 'cat', 'head', 'tail', 'df', 'free', 'uptime', 'uname', 'date', 'top', 'htop', 'ps', 'netstat', 'ss', 'ip', 'ifconfig', 'ping', 'traceroute', 'dig', 'nslookup', 'curl', 'wget', 'du', 'find', 'grep', 'wc', 'echo', 'which'],

    // Multi-provider profiles
    aiProfiles: [],
    activeProfileId: '',

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

    setAiEnabled: (enabled: boolean) => {
        set({ aiEnabled: enabled });
        window.electron.storeSet('aiEnabled', enabled);
    },

    setAiProvider: (provider: AIProvider) => {
        set({ aiProvider: provider });
        window.electron.storeSet('aiProvider', provider);
        // Update AI service config
        const state = useSettingsStore.getState();
        aiService.setConfig({
            provider,
            apiKey: state.aiApiKey,
            // Only use custom URL/model if provider is 'custom'
            baseUrl: provider === 'custom' ? (state.aiBaseUrl || undefined) : undefined,
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
            baseUrl: state.aiProvider === 'custom' ? (state.aiBaseUrl || undefined) : undefined,
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
            baseUrl: state.aiProvider === 'custom' ? (state.aiBaseUrl || undefined) : undefined,
            model: state.aiModel || undefined,
            privacyMode: enabled
        });
    },

    setAiSendShortcut: (shortcut: 'enter' | 'ctrlEnter') => {
        set({ aiSendShortcut: shortcut });
        window.electron.storeSet('aiSendShortcut', shortcut);
    },

    setAgentControlMode: (mode: 'auto' | 'approval' | 'whitelist') => {
        set({ agentControlMode: mode });
        (window as any).electron.storeSet('agentControlMode', mode);
    },

    setAgentWhitelist: (list: string[]) => {
        set({ agentWhitelist: list });
        (window as any).electron.storeSet('agentWhitelist', list);
    },

    // ── Profile CRUD ──
    addAiProfile: (profile: AIProviderProfile) => {
        const state = get();
        const updated = [...state.aiProfiles, profile];
        set({ aiProfiles: updated });
        (window as any).electron.storeSet('aiProfiles', updated);
        // If first profile, auto-activate it
        if (updated.length === 1) {
            get().setActiveProfile(profile.id);
        }
    },

    updateAiProfile: (profile: AIProviderProfile) => {
        const state = get();
        const updated = state.aiProfiles.map(p => p.id === profile.id ? profile : p);
        set({ aiProfiles: updated });
        (window as any).electron.storeSet('aiProfiles', updated);
        // If editing the active profile, re-apply config
        if (state.activeProfileId === profile.id) {
            aiService.setConfigFromProfile(profile);
        }
    },

    removeAiProfile: (id: string) => {
        const state = get();
        const updated = state.aiProfiles.filter(p => p.id !== id);
        set({ aiProfiles: updated });
        (window as any).electron.storeSet('aiProfiles', updated);
        // If removed the active one, switch to first remaining or clear
        if (state.activeProfileId === id) {
            if (updated.length > 0) {
                get().setActiveProfile(updated[0].id);
            } else {
                set({ activeProfileId: '' });
                (window as any).electron.storeSet('activeProfileId', '');
            }
        }
    },

    setActiveProfile: (id: string) => {
        const state = get();
        const profile = state.aiProfiles.find(p => p.id === id);
        set({ activeProfileId: id });
        (window as any).electron.storeSet('activeProfileId', id);
        if (profile) {
            // Sync flat fields for backward compat
            set({
                aiProvider: profile.provider,
                aiApiKey: profile.apiKey,
                aiBaseUrl: profile.baseUrl,
                aiModel: profile.model,
            });
            aiService.setConfigFromProfile(profile);
        }
    },

    // Bookmarks
    bookmarks: [],
    toggleBookmark: (path: string) => {
        const state = get();
        const newBookmarks = state.bookmarks.includes(path)
            ? state.bookmarks.filter(b => b !== path)
            : [...state.bookmarks, path];
        set({ bookmarks: newBookmarks });
        window.electron.storeSet('bookmarks', newBookmarks);
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

        // Load Bookmarks
        const savedBookmarks = await window.electron.storeGet('bookmarks');

        set({
            language: (savedLang as Language) || 'en',
            uiFontFamily: (savedUiFont as string) || "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            terminalFontFamily: (savedTerminalFont as string) || (oldFontFamily as string) || "'Inter', monospace",
            fontSize: (savedFontSize as number) || 14,
            lineHeight: (savedLineHeight as number) || 1.2,
            letterSpacing: (savedLetterSpacing as number) || 0,
            cursorStyle: (savedCursorStyle as 'block' | 'underline' | 'bar') || 'block',
            cursorBlink: typeof savedCursorBlink === 'boolean' ? savedCursorBlink : true,

            rendererType: (savedRendererType as 'canvas' | 'webgl') || 'canvas',
            scrollback: (savedScrollback as number) || 5000,
            brightBold: typeof savedBrightBold === 'boolean' ? savedBrightBold : true,
            bellStyle: (savedBellStyle as 'none' | 'visual' | 'sound') || 'none',

            bookmarks: Array.isArray(savedBookmarks) ? savedBookmarks : [],
        });

        // Load AI settings
        const savedAiEnabled = await window.electron.storeGet('aiEnabled');
        const savedAiProvider = await window.electron.storeGet('aiProvider');
        const savedAiApiKey = await window.electron.storeGet('aiApiKey');
        const savedAiBaseUrl = await window.electron.storeGet('aiBaseUrl');
        const savedAiModel = await window.electron.storeGet('aiModel');
        const savedAiPrivacyMode = await window.electron.storeGet('aiPrivacyMode');
        const savedAiSendShortcut = await window.electron.storeGet('aiSendShortcut');
        const savedAgentControlMode = await (window as any).electron.storeGet('agentControlMode');
        const savedAgentWhitelist = await (window as any).electron.storeGet('agentWhitelist');

        const aiEnabled = typeof savedAiEnabled === 'boolean' ? savedAiEnabled : true;
        const aiProvider = (savedAiProvider as AIProvider) || 'deepseek';
        const aiApiKey = (savedAiApiKey as string) || '';
        const aiBaseUrl = (savedAiBaseUrl as string) || '';
        const aiModel = (savedAiModel as string) || '';
        const aiPrivacyMode = typeof savedAiPrivacyMode === 'boolean' ? savedAiPrivacyMode : false;
        const aiSendShortcut = (savedAiSendShortcut as 'enter' | 'ctrlEnter') || 'ctrlEnter';
        const agentControlMode = (savedAgentControlMode as 'auto' | 'approval' | 'whitelist') || 'auto';
        const agentWhitelist = Array.isArray(savedAgentWhitelist) ? savedAgentWhitelist : get().agentWhitelist;

        set({ aiEnabled, aiProvider, aiApiKey, aiBaseUrl, aiModel, aiPrivacyMode, aiSendShortcut, agentControlMode, agentWhitelist });

        // ── Load profiles ──
        const savedProfiles = await (window as any).electron.storeGet('aiProfiles');
        const savedActiveProfileId = await (window as any).electron.storeGet('activeProfileId');
        let profiles: AIProviderProfile[] = Array.isArray(savedProfiles) ? savedProfiles : [];
        let activeProfileId = (savedActiveProfileId as string) || '';

        // Migration: if no profiles exist but old single-config has an API key, create first profile
        if (profiles.length === 0 && (aiApiKey || aiProvider === 'ollama')) {
            const providerConfig = AI_PROVIDER_CONFIGS[aiProvider];
            const migrated: AIProviderProfile = {
                id: `profile-${Date.now()}`,
                name: providerConfig?.displayName || aiProvider,
                provider: aiProvider,
                apiKey: aiApiKey,
                baseUrl: aiBaseUrl || providerConfig?.baseUrl || '',
                model: aiModel || providerConfig?.defaultModel || '',
                isDefault: true,
            };
            profiles = [migrated];
            activeProfileId = migrated.id;
            (window as any).electron.storeSet('aiProfiles', profiles);
            (window as any).electron.storeSet('activeProfileId', activeProfileId);
        }

        set({ aiProfiles: profiles, activeProfileId });

        // Activate the profile → sets aiService config
        const activeProfile = profiles.find(p => p.id === activeProfileId);
        if (activeProfile) {
            aiService.setConfigFromProfile(activeProfile);
        } else if (aiApiKey || aiProvider === 'ollama') {
            // Fallback: use old flat config
            aiService.setConfig({
                provider: aiProvider,
                apiKey: aiApiKey,
                baseUrl: aiProvider === 'custom' ? (aiBaseUrl || undefined) : undefined,
                model: aiModel || undefined,
                privacyMode: aiPrivacyMode
            });
        }
    }
}));
