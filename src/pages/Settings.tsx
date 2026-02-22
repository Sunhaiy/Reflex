import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import {
  ArrowLeft, Check, Smartphone, Palette, Terminal, Sparkles, Eye, EyeOff
} from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from '../hooks/useTranslation';
import { translations, Language } from '../shared/locales';
import { baseThemes, accentColors, terminalThemes, BaseThemeId, AccentColorId } from '../shared/themes';
import { AI_PROVIDER_CONFIGS, AIProvider } from '../shared/aiTypes';
import { cn } from '../lib/utils';

interface SettingsProps {
  onBack: () => void;
}

type SettingsTab = 'app' | 'appearance' | 'terminal' | 'ai';

export function Settings({ onBack }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  // New Theme Store API
  const {
    baseThemeId,
    setBaseTheme,
    accentColorId,
    setAccentColor,
    opacity,
    setOpacity,
    currentTerminalThemeId,
    setTerminalTheme
  } = useThemeStore();

  const {
    language, setLanguage,
    uiFontFamily, setUiFontFamily,
    terminalFontFamily, setTerminalFontFamily,
    fontSize, setFontSize,
    lineHeight, setLineHeight,
    letterSpacing, setLetterSpacing,
    cursorStyle, setCursorStyle,
    cursorBlink, setCursorBlink,
    rendererType, setRendererType,
    scrollback, setScrollback,
    brightBold, setBrightBold,
    bellStyle, setBellStyle,
    // AI Settings
    aiEnabled, setAiEnabled,
    aiProvider, setAiProvider,
    aiApiKey, setAiApiKey,
    aiBaseUrl, setAiBaseUrl,
    aiModel, setAiModel,
    aiPrivacyMode, setAiPrivacyMode,
    aiSendShortcut, setAiSendShortcut
  } = useSettingsStore();

  const { t } = useTranslation();

  const terminalFontOptions = [
    { label: 'Inter', value: "'Inter', monospace" },
    { label: 'Monospace (Default)', value: 'monospace' },
    { label: 'Consolas', value: "'Consolas', monospace" },
    { label: 'Fira Code', value: "'Fira Code', monospace" },
    { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
    { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
    { label: 'Roboto Mono', value: "'Roboto Mono', monospace" },
    { label: 'Ubuntu Mono', value: "'Ubuntu Mono', monospace" },
    { label: 'Courier New', value: "'Courier New', monospace" },
    { label: 'Pixel (VT323)', value: '"VT323", monospace' },
  ];

  const uiFontOptions = [
    { label: 'System Default', value: 'system-ui, -apple-system, sans-serif' },
    { label: 'Inter', value: 'Inter, sans-serif' },
    { label: 'Roboto', value: 'Roboto, sans-serif' },
    { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
    { label: 'Helvetica Neue', value: '"Helvetica Neue", Arial, sans-serif' },
  ];

  const sidebarItems: { id: SettingsTab; icon: any; label: string }[] = [
    { id: 'app', icon: Smartphone, label: t('settings.tabs.app') },
    { id: 'appearance', icon: Palette, label: t('settings.tabs.appearance') },
    { id: 'terminal', icon: Terminal, label: t('settings.tabs.terminal') },
    { id: 'ai', icon: Sparkles, label: t('settings.tabs.ai') },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'app':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.about.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {t('settings.about.desc')}
              </div>
            </CardContent>
          </Card>
        );

      case 'appearance':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.appearance.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                {/* Language */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.language')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.languageDesc')}
                  </span>
                  <select
                    className="h-9 w-full sm:w-64 px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as Language)}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </div>

                {/* UI Font */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.font')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.fontDesc')}
                  </span>
                  <select
                    className="w-full sm:w-64 p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                    value={uiFontFamily}
                    onChange={(e) => setUiFontFamily(e.target.value)}
                  >
                    {uiFontOptions.map(font => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>

                {/* Opacity */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center w-full sm:w-64">
                    <span className="font-medium text-sm">{t('settings.appearance.opacity')}</span>
                    <span className="text-xs text-muted-foreground">{Math.round(opacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.0"
                    step="0.01"
                    value={opacity}
                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                    className="w-full sm:w-64 accent-primary cursor-pointer"
                  />
                </div>

                {/* Base Theme */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.backgroundTheme')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.backgroundThemeDesc')}
                  </span>
                  <div className="grid grid-cols-3 gap-4">
                    {Object.values(baseThemes).map((theme) => (
                      <div
                        key={theme.id}
                        className={cn(
                          "cursor-pointer rounded-lg border-2 p-1 hover:border-primary transition-all",
                          baseThemeId === theme.id ? "border-primary" : "border-transparent"
                        )}
                        onClick={() => setBaseTheme(theme.id)}
                      >
                        <div
                          className="aspect-[4/3] rounded-md border shadow-sm mb-2 overflow-hidden relative flex items-center justify-center"
                          style={{
                            background: `hsl(${theme.colors.background})`,
                            color: `hsl(${theme.colors.foreground})`
                          }}
                        >
                          <span className="text-xs font-semibold">{theme.name}</span>
                          {baseThemeId === theme.id && (
                            <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Accent Color */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.accentColor')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.accentColorDesc')}
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {Object.values(accentColors).map((accent) => (
                      <button
                        key={accent.id}
                        onClick={() => setAccentColor(accent.id)}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center",
                          accentColorId === accent.id ? "border-foreground" : "border-transparent hover:scale-110"
                        )}
                        style={{ background: `hsl(${accent.color})` }}
                        title={accent.name}
                      >
                        {accentColorId === accent.id && (
                          <Check className="w-4 h-4 text-white drop-shadow-md" strokeWidth={3} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>
        );

      case 'terminal':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.terminal.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">

                {/* Terminal Theme */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.theme')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.themeDesc')}
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(terminalThemes).map(([id, theme]) => (
                      <button
                        key={id}
                        onClick={() => setTerminalTheme(id as any)}
                        className={`
                          flex flex-col gap-2 p-2 rounded-md border text-left transition-all h-full
                          ${currentTerminalThemeId === id
                            ? 'border-primary bg-primary/10 ring-1 ring-primary'
                            : 'border-input hover:bg-accent hover:text-accent-foreground'
                          }
                        `}
                      >
                        <div className="flex gap-1">
                          <div className="w-3 h-3 rounded-full" style={{ background: theme.background }}></div>
                          <div className="w-3 h-3 rounded-full" style={{ background: theme.foreground }}></div>
                          <div className="w-3 h-3 rounded-full" style={{ background: theme.blue }}></div>
                          <div className="w-3 h-3 rounded-full" style={{ background: theme.red }}></div>
                        </div>
                        <span className="text-xs font-medium truncate w-full">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.terminal.fontFamily')}</span>
                  <select
                    className="h-9 w-full sm:w-64 px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                    value={terminalFontFamily}
                    onChange={(e) => setTerminalFontFamily(e.target.value)}
                  >
                    {terminalFontOptions.map(font => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>

                {/* Font Size & Line Height Row */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-medium text-sm">{t('settings.terminal.fontSize')}</span>
                    <input
                      type="number"
                      min="10"
                      max="24"
                      className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-medium text-sm">{t('settings.terminal.lineHeight')}</span>
                    <input
                      type="number"
                      min="1.0"
                      max="2.0"
                      step="0.1"
                      className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                      value={lineHeight}
                      onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-medium text-sm">{t('settings.terminal.letterSpacing')}</span>
                    <input
                      type="number"
                      min="-5"
                      max="5"
                      step="0.5"
                      className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                      value={letterSpacing}
                      onChange={(e) => setLetterSpacing(parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                {/* Cursor Settings */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-medium text-sm">{t('settings.terminal.cursorStyle')}</span>
                    <select
                      className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                      value={cursorStyle}
                      onChange={(e) => setCursorStyle(e.target.value as any)}
                    >
                      <option value="block">Block ( █ )</option>
                      <option value="underline">Underline ( _ )</option>
                      <option value="bar">Bar ( | )</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-medium text-sm">{t('settings.terminal.cursorBlink')}</span>
                    <div className="flex items-center h-[38px]">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={cursorBlink}
                          onChange={(e) => setCursorBlink(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-input peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Rendering Settings */}
                <div className="pt-4 border-t border-border">
                  <h3 className="text-base font-semibold mb-4">{t('settings.terminal.rendering')}</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex flex-col gap-1.5 flex-1">
                        <span className="font-medium text-sm">{t('settings.terminal.rendererType')}</span>
                        <select
                          className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                          value={rendererType}
                          onChange={(e) => setRendererType(e.target.value as any)}
                        >
                          <option value="canvas">Canvas (Standard)</option>
                          <option value="webgl">WebGL (High Performance)</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1">
                        <span className="font-medium text-sm">{t('settings.terminal.scrollback')}</span>
                        <input
                          type="number"
                          min="1000"
                          max="100000"
                          step="1000"
                          className="h-9 w-full px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                          value={scrollback}
                          onChange={(e) => setScrollback(parseInt(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between sm:w-64">
                        <span className="font-medium text-sm">{t('settings.terminal.brightBold')}</span>
                        <div className="flex items-center h-[24px]">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={brightBold}
                              onChange={(e) => setBrightBold(e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-input peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sound Settings */}
                <div className="pt-4 border-t border-border">
                  <h3 className="text-base font-semibold mb-4">{t('settings.terminal.sound')}</h3>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium text-sm">{t('settings.terminal.bellStyle')}</span>
                    <div className="flex bg-background/50 rounded-md border border-input p-1 w-fit">
                      {['none', 'visual', 'sound'].map((style) => (
                        <button
                          key={style}
                          onClick={() => setBellStyle(style as any)}
                          className={cn(
                            "px-4 py-1.5 text-xs font-medium rounded-sm transition-colors",
                            bellStyle === style
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                          )}
                        >
                          {style === 'none' && 'Off'}
                          {style === 'visual' && 'Visual'}
                          {style === 'sound' && 'Audible'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>
        );

      case 'ai':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                {t('settings.ai.title')}
              </CardTitle>
              <CardDescription>
                {t('settings.ai.desc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                {/* AI Enable Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{t('settings.ai.enable')}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('settings.ai.enableDesc')}
                    </span>
                  </div>
                  <button
                    onClick={() => setAiEnabled(!aiEnabled)}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors relative",
                      aiEnabled ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow-sm",
                      aiEnabled ? "left-[22px]" : "left-0.5"
                    )} />
                  </button>
                </div>

                {/* Provider Selection - show only when enabled */}
                {aiEnabled && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-sm">{t('settings.ai.provider')}</span>
                      <span className="text-xs text-muted-foreground mb-2">
                        {t('settings.ai.providerDesc')}
                      </span>
                      <select
                        className="h-9 w-full sm:w-64 px-3 py-1 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                        value={aiProvider}
                        onChange={(e) => setAiProvider(e.target.value as AIProvider)}
                      >
                        {Object.entries(AI_PROVIDER_CONFIGS).map(([key, config]) => (
                          <option key={key} value={key}>{config.displayName}</option>
                        ))}
                      </select>
                    </div>

                    {/* API Key */}
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-sm">{t('settings.ai.apiKey')}</span>
                      <span className="text-xs text-muted-foreground mb-2">
                        {t('settings.ai.apiKeyDesc')}
                      </span>
                      <div className="relative">
                        <input
                          type="password"
                          className="w-full sm:w-96 p-2 pr-10 rounded-md border border-input bg-background/50 hover:bg-accent/30 text-sm font-mono"
                          placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                        />
                      </div>
                      {aiApiKey && (
                        <span className="text-xs text-green-500 flex items-center gap-1">
                          <Check className="w-3 h-3" /> API Key Configured
                        </span>
                      )}
                    </div>

                    {/* Custom Base URL (for custom providers) */}
                    {aiProvider === 'custom' && (
                      <div className="flex flex-col gap-1.5">
                        <span className="font-medium text-sm">{t('settings.ai.baseUrl')}</span>
                        <span className="text-xs text-muted-foreground mb-2">
                          {t('settings.ai.baseUrlDesc')}
                        </span>
                        <input
                          type="text"
                          className="w-full sm:w-96 p-2 rounded-md border border-input bg-background/50 hover:bg-accent/30 text-sm font-mono"
                          placeholder="https://api.example.com"
                          value={aiBaseUrl}
                          onChange={(e) => setAiBaseUrl(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Model Override */}
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-sm">{t('settings.ai.model')}</span>
                      <span className="text-xs text-muted-foreground mb-2">
                        {t('settings.ai.modelDesc')} {AI_PROVIDER_CONFIGS[aiProvider]?.defaultModel}
                      </span>
                      <input
                        type="text"
                        className="w-full sm:w-64 p-2 rounded-md border border-input bg-background/50 hover:bg-accent/30 text-sm"
                        placeholder={AI_PROVIDER_CONFIGS[aiProvider]?.defaultModel}
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                      />
                    </div>

                    {/* Privacy Mode Toggle */}
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-sm">{t('settings.ai.privacy')}</span>
                      <span className="text-xs text-muted-foreground mb-2">
                        {t('settings.ai.privacyDesc')}
                      </span>
                      <button
                        onClick={() => setAiPrivacyMode(!aiPrivacyMode)}
                        className={cn(
                          "flex items-center gap-2 w-fit px-4 py-2 rounded-md text-sm transition-colors",
                          aiPrivacyMode
                            ? "bg-green-500/20 text-green-500 border border-green-500/50"
                            : "bg-muted text-muted-foreground border border-input hover:bg-accent"
                        )}
                      >
                        {aiPrivacyMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        {aiPrivacyMode ? 'On' : 'Off'}
                      </button>
                    </div>

                    {/* Send Shortcut */}
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-sm">{t('settings.ai.shortcut')}</span>
                      <span className="text-xs text-muted-foreground mb-2">
                        {t('settings.ai.shortcutDesc')}
                      </span>
                      <div className="flex bg-background/50 rounded-md border border-input p-1 w-fit">
                        {[
                          { id: 'enter', label: 'Enter' },
                          { id: 'ctrlEnter', label: 'Ctrl + Enter' }
                        ].map((shortcut) => (
                          <button
                            key={shortcut.id}
                            onClick={() => setAiSendShortcut(shortcut.id as 'enter' | 'ctrlEnter')}
                            className={cn(
                              "px-4 py-1.5 text-xs font-medium rounded-sm transition-colors",
                              aiSendShortcut === shortcut.id
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                          >
                            {shortcut.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full bg-transparent overflow-hidden animate-in fade-in duration-300">
      {/* Sidebar */}
      <div className="w-64 border-r bg-card/50 flex flex-col h-full">
        <div className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-lg">{t('settings.title')}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                activeTab === item.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto animate-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight">
                {sidebarItems.find(i => i.id === activeTab)?.label}
              </h2>
              <p className="text-muted-foreground mt-1">
                Manage your settings
              </p>
            </div>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
