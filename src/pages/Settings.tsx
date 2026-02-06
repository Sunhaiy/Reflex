import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'; // Modified: Added CardDescription
import {
  ArrowLeft, Check, Smartphone, Palette, Terminal, CreditCard, Keyboard, Monitor, Volume2, Type, Sparkles, Eye, EyeOff // Added AI icons
} from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from '../hooks/useTranslation'; // Kept original path
import { translations, Language } from '../shared/locales';
import { themes, terminalThemes, ThemeId } from '../shared/themes';
import { AI_PROVIDER_CONFIGS, AIProvider } from '../shared/aiTypes';
import { cn } from '../lib/utils';

interface SettingsProps {
  onBack: () => void;
}

type SettingsTab = 'app' | 'appearance' | 'terminal' | 'ai';

export function Settings({ onBack }: SettingsProps) { // Kept original SettingsProps type
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { currentThemeId, setTheme, opacity, setOpacity, currentTerminalThemeId, setTerminalTheme } = useThemeStore(); // Modified: Added currentTerminalThemeId, setTerminalTheme

  // Fix: Destructure all settings at the top level to adhere to Rules of Hooks
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
    aiProvider, setAiProvider,
    aiApiKey, setAiApiKey,
    aiBaseUrl, setAiBaseUrl,
    aiModel, setAiModel,
    aiPrivacyMode, setAiPrivacyMode
  } = useSettingsStore();

  const { t } = useTranslation();

  const terminalFontOptions = [
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
    { id: 'app', icon: Smartphone, label: '应用 (App)' },
    { id: 'appearance', icon: Palette, label: '外观 (Appearance)' },
    { id: 'terminal', icon: Terminal, label: '终端 (Terminal)' },
    { id: 'ai', icon: Sparkles, label: 'AI 智能 (AI)' },
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
                    className="w-full sm:w-64 p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                    <span className="font-medium text-sm">Window Opacity</span>
                    <span className="text-xs text-muted-foreground">{Math.round(opacity * 100)}%</span>
                  </div>
                  <span className="text-xs text-muted-foreground mb-2">
                    Adjust the transparency of the window background.
                  </span>
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

                {/* Theme */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">{t('settings.appearance.theme')}</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.appearance.themeDesc')}
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {(Object.keys(themes) as ThemeId[]).map((themeId) => {
                      const theme = themes[themeId];
                      return (
                        <div
                          key={themeId}
                          className={cn(
                            "cursor-pointer rounded-lg border-2 p-1 hover:border-primary transition-all",
                            currentThemeId === themeId ? "border-primary" : "border-transparent"
                          )}
                          onClick={() => setTheme(themeId)}
                        >
                          <div
                            className="aspect-[4/3] rounded-md border shadow-sm mb-2 overflow-hidden relative"
                            style={{
                              background: `hsl(${theme.colors.background})`,
                              color: `hsl(${theme.colors.foreground})`
                            }}
                          >
                            {/* Mini UI Preview */}
                            <div className="h-2 w-full absolute top-0 left-0 opacity-80" style={{ background: `hsl(${theme.colors.border})` }} />
                            <div className="p-2 pt-4 flex flex-col gap-1">
                              <div className="h-1.5 w-1/2 rounded-full opacity-60" style={{ background: `hsl(${theme.colors.foreground})` }} />
                              <div className="h-1.5 w-3/4 rounded-full opacity-40" style={{ background: `hsl(${theme.colors.foreground})` }} />
                              <div className="mt-1 h-4 w-full rounded border opacity-80 flex items-center justify-center" style={{ borderColor: `hsl(${theme.colors.border})`, background: `hsl(${theme.colors.card})` }}>
                                <span className="text-[6px]">SSH</span>
                              </div>
                              <div className="mt-1 flex-1 rounded p-1 font-mono text-[5px] overflow-hidden leading-tight" style={{ background: theme.terminal.background, color: theme.terminal.foreground }}>
                                $ echo hello<br />
                                <span style={{ color: theme.terminal.green }}>world</span>
                              </div>
                            </div>
                            {currentThemeId === themeId && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20 dark:bg-white/20">
                                <div className="bg-primary text-primary-foreground rounded-full p-1">
                                  <Check className="w-3 h-3" />
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="text-center text-xs font-medium truncate px-1">
                            {theme.name}
                          </div>
                        </div>
                      );
                    })}
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
                  <span className="font-medium text-sm">Terminal Theme</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    Select a color scheme for the terminal.
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(terminalThemes).map(([id, theme]) => (
                      <button
                        key={id}
                        onClick={() => setTerminalTheme(id as any)} // Cast just in case
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
                  <span className="text-xs text-muted-foreground mb-2">
                    {t('settings.terminal.fontFamilyDesc')}
                  </span>
                  <select
                    className="w-full sm:w-64 p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                      className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                      className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                      className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                      className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                        <span className="text-xs text-muted-foreground mb-1">
                          {t('settings.terminal.rendererTypeDesc')}
                        </span>
                        <select
                          className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
                          value={rendererType}
                          onChange={(e) => setRendererType(e.target.value as any)}
                        >
                          <option value="canvas">Canvas (Standard)</option>
                          <option value="webgl">WebGL (High Performance)</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1">
                        <span className="font-medium text-sm">{t('settings.terminal.scrollback')}</span>
                        <span className="text-xs text-muted-foreground mb-1">
                          {t('settings.terminal.scrollbackDesc')}
                        </span>
                        <input
                          type="number"
                          min="1000"
                          max="100000"
                          step="1000"
                          className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                      <span className="text-xs text-muted-foreground">
                        {t('settings.terminal.brightBoldDesc')}
                      </span>
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

                {/* Terminal Theme Selector */}
                <div className="pt-4 border-t border-border">
                  <h3 className="text-base font-semibold mb-4">{t('settings.terminal.theme')}</h3>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium text-sm">Theme</span>
                    <span className="text-xs text-muted-foreground mb-2">
                      Select the terminal color theme.
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.values(themes).map((tValue) => (
                        <button
                          key={tValue.id}
                          onClick={() => setTheme(tValue.id)}
                          className={`
                            flex items-center gap-2 p-2 rounded-md border text-left transition-all
                            ${currentThemeId === tValue.id
                              ? 'border-primary bg-primary/10 ring-1 ring-primary'
                              : 'border-input hover:bg-accent hover:text-accent-foreground'
                            }
                          `}
                        >
                          <div className="w-4 h-4 rounded-full border border-border" style={{ background: tValue.colors.background }}></div>
                          <span className="text-sm">{tValue.name}</span>
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
                AI 智能助手
              </CardTitle>
              <CardDescription>
                配置 AI 服务以启用自然语言转指令、智能报错分析等功能
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                {/* Provider Selection */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-sm">AI 服务提供商</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    选择你的 AI API 提供商
                  </span>
                  <select
                    className="w-full sm:w-64 p-2 rounded-md border border-input bg-background/50 hover:bg-accent hover:text-accent-foreground text-sm"
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
                  <span className="font-medium text-sm">API Key</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    填入你的 API 密钥 (将安全存储在本地)
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
                      <Check className="w-3 h-3" /> API Key 已配置
                    </span>
                  )}
                </div>

                {/* Custom Base URL (for custom providers) */}
                {aiProvider === 'custom' && (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium text-sm">自定义 Base URL</span>
                    <span className="text-xs text-muted-foreground mb-2">
                      输入你的 API 端点地址
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
                  <span className="font-medium text-sm">模型 (可选)</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    留空使用默认模型: {AI_PROVIDER_CONFIGS[aiProvider]?.defaultModel}
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
                  <span className="font-medium text-sm">隐私模式</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    开启后将自动脱敏 IP、密码等敏感信息
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
                    {aiPrivacyMode ? '已开启' : '已关闭'}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full bg-background overflow-hidden animate-in fade-in duration-300">
      {/* Sidebar */}
      <div className="w-64 border-r bg-background/50 flex flex-col h-full">
        <div className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-lg">{t('settings.title')}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
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
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto animate-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight">
                {sidebarItems.find(i => i.id === activeTab)?.label}
              </h2>
              <p className="text-muted-foreground mt-1">
                Manage your {sidebarItems.find(i => i.id === activeTab)?.label.split(' ')[0]} settings
              </p>
            </div>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
