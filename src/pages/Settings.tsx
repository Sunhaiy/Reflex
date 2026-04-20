import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Palette,
  Pencil,
  Plus,
  Smartphone,
  Sparkles,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { AI_PROVIDER_CONFIGS, AIProvider, AIProviderProfile } from '../shared/aiTypes';
import { Language } from '../shared/locales';
import { accentColors, baseThemes, BaseThemeId, terminalThemes, TerminalThemeId } from '../shared/themes';

interface SettingsProps {
  onBack: () => void;
}

type SettingsTab = 'app' | 'appearance' | 'terminal' | 'ai';

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary peer-checked:after:translate-x-full after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all" />
    </label>
  );
}

export function Settings({ onBack }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [visibleProfileKeys, setVisibleProfileKeys] = useState<Record<string, boolean>>({});

  const {
    baseThemeId,
    accentColorId,
    setBaseTheme,
    setAccentColor,
    currentTerminalThemeId,
    setTerminalTheme,
  } = useThemeStore();

  const {
    language,
    setLanguage,
    uiFontFamily,
    setUiFontFamily,
    terminalFontFamily,
    setTerminalFontFamily,
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    letterSpacing,
    setLetterSpacing,
    cursorStyle,
    setCursorStyle,
    cursorBlink,
    setCursorBlink,
    rendererType,
    setRendererType,
    scrollback,
    setScrollback,
    brightBold,
    setBrightBold,
    bellStyle,
    setBellStyle,
    aiEnabled,
    setAiEnabled,
    aiPrivacyMode,
    setAiPrivacyMode,
    aiSendShortcut,
    setAiSendShortcut,
    aiProfiles,
    addAiProfile,
    updateAiProfile,
    removeAiProfile,
    activeProfileId,
    setActiveProfile,
  } = useSettingsStore();

  const defaultProviderConfig = AI_PROVIDER_CONFIGS.deepseek;
  const emptyForm = {
    name: '',
    provider: 'deepseek' as AIProvider,
    apiKey: '',
    baseUrl: defaultProviderConfig.baseUrl,
    model: defaultProviderConfig.defaultModel,
    modelsText: defaultProviderConfig.defaultModel,
  };
  const [formData, setFormData] = useState(emptyForm);

  const { t } = useTranslation();
  const isZh = language === 'zh';
  const text = {
    addProfile: isZh ? '添加配置' : 'Add profile',
    emptyProfiles: isZh ? '还没有 AI 配置，先添加一个提供商。' : 'No AI profiles yet. Add a provider first.',
    current: isZh ? '当前' : 'Current',
    noKey: isZh ? '无密钥' : 'No key',
    setDefault: isZh ? '设为默认' : 'Set default',
    edit: isZh ? '编辑' : 'Edit',
    delete: isZh ? '删除' : 'Delete',
    editProfile: isZh ? '编辑配置' : 'Edit profile',
    addNewProfile: isZh ? '添加新配置' : 'Add new profile',
    profileNamePlaceholder: isZh ? '配置名称，例如 DeepSeek V3' : 'Profile name, e.g. DeepSeek V3',
    primaryModel: isZh ? '默认模型' : 'Default model',
    modelList: isZh ? '模型列表' : 'Model list',
    modelListHint: isZh ? '每行一个模型。同一个接口下，Agent 可以直接从这里切换模型。' : 'One model per line. The Agent can switch between these models on the same endpoint.',
    save: isZh ? '保存' : 'Save',
    add: isZh ? '添加' : 'Add',
    cancel: isZh ? '取消' : 'Cancel',
    hideKey: isZh ? '隐藏密钥' : 'Hide key',
    showKey: isZh ? '查看密钥' : 'Show key',
    modelsCount: (count: number) => isZh ? `${count} 个模型` : `${count} model${count === 1 ? '' : 's'}`,
    appearanceDesc: isZh ? '主题、终端和 AI 偏好都在这里统一调整。' : 'Theme, terminal, and AI preferences are adjusted here.',
    officialThemeDesc: isZh ? '官方主题和主色统一管理，切换成本更低。' : 'Official themes and accent colors are managed together.',
    accentTitle: isZh ? '主题主色' : 'Accent color',
    accentDesc: isZh ? '夜间主题不再固定蓝色。炫酷黑和炫酷白支持自定义主色，赛博朋克主题保留自己的专属配色。' : 'Dark themes no longer force blue. Cool Black and Cool White support custom accents; Cyberpunk keeps its own palette.',
    accentDefault: isZh ? '默认推荐' : 'Default choice',
    accentUsage: isZh ? '可用于强调按钮、状态和进度' : 'Used for buttons, status, and progress',
    accentLocked: isZh ? '当前主题使用固定主色。你选中的颜色会保留，在切回炫酷黑或炫酷白时自动生效。' : 'The current theme uses a fixed accent. Your selection is saved and will apply when switching back to Cool Black or Cool White.',
    terminalPresetDesc: isZh ? '终端预设与 UI 主题一一对应，避免再出现一大屏主题列表。' : 'Terminal presets map to UI themes to keep this page compact.',
    brightBoldDesc: isZh ? '亮色字符自动加粗' : 'Render bright text as bold.',
  };

  const normalizeModelList = (value: string, fallback?: string) => {
    const rawModels = value.split(/[\n,，]+/).map((model) => model.trim()).filter(Boolean);
    const models = [fallback?.trim(), ...rawModels].filter((model): model is string => Boolean(model));
    return Array.from(new Set(models));
  };

  const maskApiKey = (apiKey: string) => {
    if (!apiKey) return text.noKey;
    if (apiKey.length <= 10) return '••••••';
    return `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}`;
  };

  const uiFontOptions = [
    { label: isZh ? '系统默认' : 'System Default', value: 'system-ui, -apple-system, sans-serif' },
    { label: 'Inter', value: 'Inter, sans-serif' },
    { label: 'Roboto', value: 'Roboto, sans-serif' },
    { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
    { label: 'Helvetica Neue', value: '"Helvetica Neue", Arial, sans-serif' },
  ];

  const terminalFontOptions = [
    { label: 'Inter', value: "'Inter', monospace" },
    { label: isZh ? '等宽字体（默认）' : 'Monospace (Default)', value: 'monospace' },
    { label: 'Consolas', value: "'Consolas', monospace" },
    { label: 'Fira Code', value: "'Fira Code', monospace" },
    { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
    { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
    { label: 'Roboto Mono', value: "'Roboto Mono', monospace" },
    { label: 'Ubuntu Mono', value: "'Ubuntu Mono', monospace" },
    { label: 'Courier New', value: "'Courier New', monospace" },
    { label: 'Pixel (VT323)', value: '"VT323", monospace' },
  ];

  const curatedThemes: Array<{ id: BaseThemeId; label: string; description: string }> = [
    { id: 'coolBlack', label: isZh ? '炫酷黑' : 'Cool Black', description: isZh ? '深色高对比，聚焦内容和终端。' : 'High-contrast dark UI focused on content and terminals.' },
    { id: 'coolWhite', label: isZh ? '炫酷白' : 'Cool White', description: isZh ? '清爽纯白，适合白天和演示。' : 'Clean light UI for daytime work and demos.' },
    { id: 'blossom', label: isZh ? '落樱' : 'Blossom', description: isZh ? '柔和樱粉，保留一点轻盈氛围。' : 'Soft sakura palette with a light touch.' },
    { id: 'cyberpunk', label: isZh ? '赛博朋克 2077' : 'Cyberpunk 2077', description: isZh ? '高对比霓虹夜景，保留专属黄青配色。' : 'Neon night contrast with a dedicated yellow/cyan palette.' },
  ];

  const curatedTerminalThemes: Array<{ id: TerminalThemeId; label: string; description: string }> = [
    { id: 'default', label: isZh ? '黑域终端' : 'Dark Terminal', description: isZh ? '适配炫酷黑的深色终端。' : 'Dark terminal preset for Cool Black.' },
    { id: 'githubLight', label: isZh ? '白域终端' : 'Light Terminal', description: isZh ? '适配炫酷白的浅色终端。' : 'Light terminal preset for Cool White.' },
    { id: 'taxuexunmei', label: isZh ? '落樱终端' : 'Blossom Terminal', description: isZh ? '适配落樱的柔和浅色终端。' : 'Soft terminal preset for Blossom.' },
    { id: 'cyberpunk', label: isZh ? '赛博终端' : 'Cyber Terminal', description: isZh ? '适配赛博朋克 2077 的黄青终端。' : 'Yellow/cyan terminal preset for Cyberpunk 2077.' },
  ];

  const accentOptions = Object.values(accentColors);
  const accentSelectionEnabled = Boolean(baseThemes[baseThemeId].allowAccentOverride);

  const languageOptions = [
    { label: 'English', value: 'en' },
    { label: '中文', value: 'zh' },
    { label: '日本語', value: 'ja' },
    { label: '한국어', value: 'ko' },
  ];

  const sidebarItems: { id: SettingsTab; icon: any; label: string }[] = [
    { id: 'app', icon: Smartphone, label: t('settings.tabs.app') },
    { id: 'appearance', icon: Palette, label: t('settings.tabs.appearance') },
    { id: 'terminal', icon: Terminal, label: t('settings.tabs.terminal') },
    { id: 'ai', icon: Sparkles, label: t('settings.tabs.ai') },
  ];

  const cardClass = 'border-border/70 bg-card/70 backdrop-blur-xl';
  const sectionClass = 'rounded-xl border border-border/60 bg-background/35 p-4';

  const renderAppearanceThemeCard = ({
    id,
    label,
    description,
  }: {
    id: BaseThemeId;
    label: string;
    description: string;
  }) => {
    const theme = baseThemes[id];
    const isActive = baseThemeId === id;
    const previewPrimary = theme.allowAccentOverride
      ? accentColors[accentColorId].color
      : (theme.colorOverrides?.primary ?? theme.colors.foreground);

    return (
      <button
        key={id}
        type="button"
        onClick={() => setBaseTheme(id)}
        className={cn(
          'rounded-2xl border p-2.5 text-left transition-all',
          isActive
            ? 'border-primary/55 bg-primary/[0.06]'
            : 'border-border/70 bg-background/40 hover:border-primary/40 hover:bg-accent/40'
        )}
      >
        <div
          className="relative h-24 overflow-hidden rounded-xl border border-border/50 px-3 py-3"
          style={{
            background: `hsl(${theme.colors.background})`,
            color: `hsl(${theme.colors.foreground})`,
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold tracking-wide">{label}</div>
              <div className="mt-1 text-[11px] opacity-70">{theme.type === 'dark' ? 'Dark UI' : 'Light UI'}</div>
            </div>
            {isActive && (
              <div className="rounded-full bg-primary p-1 text-primary-foreground shadow-md">
                <Check className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full border border-black/10"
              style={{ background: `hsl(${previewPrimary})` }}
            />
            <div className="h-2.5 flex-1 rounded-full" style={{ background: `hsl(${theme.colors.secondary})` }} />
            <div className="h-2.5 w-8 rounded-full" style={{ background: `hsl(${theme.colors.card})` }} />
          </div>
        </div>
        <div className="px-1 pt-3">
          <div className="text-sm font-medium">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
      </button>
    );
  };

  const renderTerminalThemeCard = ({
    id,
    label,
    description,
  }: {
    id: TerminalThemeId;
    label: string;
    description: string;
  }) => {
    const theme = terminalThemes[id];
    const isActive = currentTerminalThemeId === id;

    return (
      <button
        key={id}
        type="button"
        onClick={() => setTerminalTheme(id)}
        className={cn(
          'rounded-2xl border p-3 text-left transition-all',
          isActive
            ? 'border-primary/55 bg-primary/[0.06]'
            : 'border-border/70 bg-background/40 hover:border-primary/40 hover:bg-accent/40'
        )}
      >
        <div className="rounded-xl border border-border/50 p-3" style={{ background: theme.background, color: theme.foreground }}>
          <div className="mb-3 flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: theme.foreground }} />
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: theme.blue }} />
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: theme.red }} />
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: theme.green }} />
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="h-2.5 w-20 rounded-full bg-white/15" />
            <div className="h-2.5 w-14 rounded-full bg-white/10" />
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{description}</div>
          </div>
          {isActive && (
            <div className="rounded-full bg-primary p-1 text-primary-foreground shadow-md">
              <Check className="h-3.5 w-3.5" />
            </div>
          )}
        </div>
      </button>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'app':
        return (
          <Card className={cardClass}>
            <CardHeader className="border-b border-border/60 px-4 py-4 sm:px-5">
              <CardTitle className="text-base">{t('settings.about.title')}</CardTitle>
              <CardDescription className="text-xs">{t('settings.about.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 py-4 sm:px-5">
              <div className="whitespace-pre-line text-sm text-muted-foreground">{t('settings.about.desc')}</div>
            </CardContent>
          </Card>
        );

      case 'appearance':
        return (
          <Card className={cardClass}>
            <CardHeader className="border-b border-border/60 px-4 py-4 sm:px-5">
              <CardTitle className="text-base">{t('settings.appearance.title')}</CardTitle>
              <CardDescription className="text-xs">
                {text.officialThemeDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4 py-4 sm:px-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className={sectionClass}>
                  <span className="text-sm font-medium">{t('settings.appearance.language')}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t('settings.appearance.languageDesc')}</span>
                  <Select
                    className="mt-3 w-full"
                    value={language}
                    onChange={(value) => setLanguage(value as Language)}
                    options={languageOptions}
                  />
                </div>

                <div className={sectionClass}>
                  <span className="text-sm font-medium">{t('settings.appearance.font')}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t('settings.appearance.fontDesc')}</span>
                  <Select
                    className="mt-3 w-full"
                    value={uiFontFamily}
                    onChange={setUiFontFamily}
                    options={uiFontOptions}
                  />
                </div>
              </div>

              <div className={sectionClass}>
                <div className="mb-3">
                  <span className="text-sm font-medium">{t('settings.appearance.backgroundTheme')}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t('settings.appearance.backgroundThemeDesc')}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{curatedThemes.map(renderAppearanceThemeCard)}</div>
              </div>

              <div className={sectionClass}>
                <div className="mb-3">
                  <span className="text-sm font-medium">{text.accentTitle}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {text.accentDesc}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {accentOptions.map((accent) => {
                    const isActive = accentColorId === accent.id;

                    return (
                      <button
                        key={accent.id}
                        type="button"
                        onClick={() => setAccentColor(accent.id)}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                          isActive
                            ? 'border-primary/50 bg-primary/[0.06]'
                            : 'border-border/70 bg-background/35 hover:border-primary/35 hover:bg-accent/35'
                        )}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: `hsl(${accent.color})` }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{accent.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {accent.id === 'teal' ? text.accentDefault : text.accentUsage}
                          </span>
                        </span>
                        {isActive && (
                          <span className="rounded-full bg-primary/12 p-1 text-primary">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!accentSelectionEnabled && (
                  <div className="mt-3 rounded-lg border border-border/60 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                    {text.accentLocked}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );

      case 'terminal':
        return (
          <Card className={cardClass}>
            <CardHeader className="border-b border-border/60 px-4 py-4 sm:px-5">
              <CardTitle className="text-base">{t('settings.terminal.title')}</CardTitle>
              <CardDescription className="text-xs">
                {text.terminalPresetDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4 py-4 sm:px-5">
              <div className={sectionClass}>
                <div className="mb-3">
                  <span className="text-sm font-medium">{t('settings.appearance.theme')}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t('settings.appearance.themeDesc')}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{curatedTerminalThemes.map(renderTerminalThemeCard)}</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={sectionClass}>
                  <span className="text-sm font-medium">{t('settings.terminal.fontFamily')}</span>
                  <Select
                    className="mt-3 w-full"
                    value={terminalFontFamily}
                    onChange={setTerminalFontFamily}
                    options={terminalFontOptions}
                  />
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium">{t('settings.terminal.fontSize')}</span>
                      <Input
                        type="number"
                        min="10"
                        max="24"
                        value={fontSize}
                        onChange={(event) => setFontSize(parseInt(event.target.value, 10))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium">{t('settings.terminal.lineHeight')}</span>
                      <Input
                        type="number"
                        min="1.0"
                        max="2.0"
                        step="0.1"
                        value={lineHeight}
                        onChange={(event) => setLineHeight(parseFloat(event.target.value))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium">{t('settings.terminal.letterSpacing')}</span>
                      <Input
                        type="number"
                        min="-5"
                        max="5"
                        step="0.5"
                        value={letterSpacing}
                        onChange={(event) => setLetterSpacing(parseFloat(event.target.value))}
                      />
                    </div>
                  </div>
                </div>

                <div className={sectionClass}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">{t('settings.terminal.cursorStyle')}</span>
                      <Select
                        value={cursorStyle}
                        onChange={(value) => setCursorStyle(value as 'block' | 'underline' | 'bar')}
                        options={[
                          { label: 'Block', value: 'block' },
                          { label: 'Underline', value: 'underline' },
                          { label: 'Bar', value: 'bar' },
                        ]}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/30 px-3 py-2">
                      <span className="text-xs font-medium">{t('settings.terminal.cursorBlink')}</span>
                      <ToggleSwitch checked={cursorBlink} onChange={setCursorBlink} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={sectionClass}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">{t('settings.terminal.rendererType')}</span>
                      <Select
                        value={rendererType}
                        onChange={(value) => setRendererType(value as 'canvas' | 'webgl')}
                        options={[
                          { label: 'Canvas', value: 'canvas' },
                          { label: 'WebGL', value: 'webgl' },
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">{t('settings.terminal.scrollback')}</span>
                      <Input
                        type="number"
                        min="1000"
                        max="100000"
                        step="1000"
                        value={scrollback}
                        onChange={(event) => setScrollback(parseInt(event.target.value, 10))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{t('settings.terminal.brightBold')}</div>
                      <div className="text-xs text-muted-foreground">{text.brightBoldDesc}</div>
                    </div>
                    <ToggleSwitch checked={brightBold} onChange={setBrightBold} />
                  </div>
                </div>

                <div className={sectionClass}>
                  <span className="text-sm font-medium">{t('settings.terminal.bellStyle')}</span>
                  <div className="mt-3 flex w-fit rounded-md border border-input bg-background/50 p-1">
                    {[
                      { id: 'none', label: 'Off' },
                      { id: 'visual', label: 'Visual' },
                      { id: 'sound', label: 'Audible' },
                    ].map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setBellStyle(style.id as 'none' | 'visual' | 'sound')}
                        className={cn(
                          'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                          bellStyle === style.id
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'ai':
        return (
          <Card className={cardClass}>
            <CardHeader className="border-b border-border/60 px-4 py-4 sm:px-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-5 w-5" />
                {t('settings.ai.title')}
              </CardTitle>
              <CardDescription className="text-xs">{t('settings.ai.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/35 p-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{t('settings.ai.enable')}</span>
                  <span className="text-xs text-muted-foreground">{t('settings.ai.enableDesc')}</span>
                </div>
                <ToggleSwitch checked={aiEnabled} onChange={setAiEnabled} />
              </div>

              {aiEnabled && (
                <>
                  <div className={sectionClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{t('settings.ai.provider')}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{t('settings.ai.providerDesc')}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...emptyForm });
                          setEditingProfile(null);
                          setShowAddForm(true);
                        }}
                        className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        <Plus className="h-3 w-3" />
                        {text.addProfile}
                      </button>
                    </div>

                    {aiProfiles.length === 0 && !showAddForm && (
                      <div className="mt-3 rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground/70">
                        <Cpu className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        {text.emptyProfiles}
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {aiProfiles.map((profile) => (
                        <div
                          key={profile.id}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                            activeProfileId === profile.id
                              ? 'border-primary/50 bg-primary/5'
                              : 'border-border bg-muted/20 hover:bg-muted/40'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveProfile(profile.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{profile.name}</span>
                              {activeProfileId === profile.id && (
                                <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  {text.current}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{AI_PROVIDER_CONFIGS[profile.provider]?.displayName || profile.provider}</span>
                              <span className="opacity-40">·</span>
                              <span className="font-mono">{profile.model || AI_PROVIDER_CONFIGS[profile.provider]?.defaultModel}</span>
                              {profile.models?.length ? (
                                <>
                                  <span className="opacity-40">·</span>
                                  <span>{text.modelsCount(profile.models.length)}</span>
                                </>
                              ) : null}
                              <span className="opacity-40">·</span>
                              <span className="font-mono">{visibleProfileKeys[profile.id] ? (profile.apiKey || text.noKey) : maskApiKey(profile.apiKey)}</span>
                            </div>
                          </button>

                          <div className="flex flex-shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setVisibleProfileKeys((prev) => ({ ...prev, [profile.id]: !prev[profile.id] }))}
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
                              title={visibleProfileKeys[profile.id] ? text.hideKey : text.showKey}
                            >
                              {visibleProfileKeys[profile.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveProfile(profile.id)}
                              className={cn(
                                'rounded-md p-1.5 transition-colors',
                                activeProfileId === profile.id
                                  ? 'text-yellow-500'
                                  : 'text-muted-foreground/40 hover:bg-yellow-500/10 hover:text-yellow-500'
                              )}
                              title={text.setDefault}
                            >
                              <Star className={cn('h-3.5 w-3.5', activeProfileId === profile.id && 'fill-current')} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFormData({
                                  name: profile.name,
                                  provider: profile.provider,
                                  apiKey: profile.apiKey,
                                  baseUrl: profile.baseUrl,
                                  model: profile.model,
                                  modelsText: (profile.models?.length ? profile.models : [profile.model]).filter(Boolean).join('\n'),
                                });
                                setEditingProfile(profile.id);
                                setShowAddForm(true);
                              }}
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
                              title={text.edit}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAiProfile(profile.id)}
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title={text.delete}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {showAddForm && (
                      <div className="mt-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <div className="text-sm font-medium">{editingProfile ? text.editProfile : text.addNewProfile}</div>

                        <Select
                          className="w-full sm:w-64"
                          value={formData.provider}
                          onChange={(value) => {
                            const provider = value as AIProvider;
                            const config = AI_PROVIDER_CONFIGS[provider];
                            setFormData({
                              ...formData,
                              provider,
                              baseUrl: config?.baseUrl || '',
                              model: config?.defaultModel || '',
                              modelsText: config?.defaultModel || '',
                              name: formData.name || config?.displayName || provider,
                            });
                          }}
                          options={Object.entries(AI_PROVIDER_CONFIGS).map(([key, config]) => ({
                            label: config.displayName,
                            value: key,
                          }))}
                        />

                        <Input
                          type="text"
                          className="w-full sm:w-64"
                          placeholder={text.profileNamePlaceholder}
                          value={formData.name}
                          onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                        />

                        <div className="relative w-full sm:w-96">
                          <Input
                            type={showApiKey ? 'text' : 'password'}
                            className="w-full pr-10 font-mono"
                            placeholder="API Key (sk-xxx...)"
                            value={formData.apiKey}
                            onChange={(event) => setFormData({ ...formData, apiKey: event.target.value })}
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((value) => !value)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title={showApiKey ? text.hideKey : text.showKey}
                          >
                            {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Base URL</span>
                          <Input
                            type="text"
                            className="w-full sm:w-96 font-mono text-xs"
                            placeholder={AI_PROVIDER_CONFIGS[formData.provider]?.baseUrl || 'https://api.example.com'}
                            value={formData.baseUrl}
                            onChange={(event) => setFormData({ ...formData, baseUrl: event.target.value })}
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">{text.primaryModel}</span>
                          <Input
                            type="text"
                            className="w-full sm:w-64 font-mono text-xs"
                            placeholder={AI_PROVIDER_CONFIGS[formData.provider]?.defaultModel || 'model-name'}
                            value={formData.model}
                            onChange={(event) => setFormData({ ...formData, model: event.target.value })}
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">{text.modelList}</span>
                          <textarea
                            className="min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50"
                            placeholder={AI_PROVIDER_CONFIGS[formData.provider]?.defaultModel || 'model-name'}
                            value={formData.modelsText}
                            onChange={(event) => setFormData({ ...formData, modelsText: event.target.value })}
                          />
                          <span className="text-[11px] text-muted-foreground">{text.modelListHint}</span>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => {
                              const config = AI_PROVIDER_CONFIGS[formData.provider];
                              const models = normalizeModelList(formData.modelsText, formData.model || config?.defaultModel || '');
                              const primaryModel = formData.model || models[0] || config?.defaultModel || '';
                              const profile: AIProviderProfile = {
                                id: editingProfile || `profile-${Date.now()}`,
                                name: formData.name || config?.displayName || formData.provider,
                                provider: formData.provider,
                                apiKey: formData.apiKey,
                                baseUrl: formData.baseUrl || config?.baseUrl || '',
                                model: primaryModel,
                                models,
                              };

                              if (editingProfile) {
                                updateAiProfile(profile);
                              } else {
                                addAiProfile(profile);
                              }

                              setShowAddForm(false);
                              setEditingProfile(null);
                              setFormData({ ...emptyForm });
                            }}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            {editingProfile ? text.save : text.add}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setShowAddForm(false);
                              setEditingProfile(null);
                              setFormData({ ...emptyForm });
                            }}
                          >
                            {text.cancel}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className={sectionClass}>
                      <span className="text-sm font-medium">{t('settings.ai.privacy')}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{t('settings.ai.privacyDesc')}</span>
                      <button
                        type="button"
                        onClick={() => setAiPrivacyMode(!aiPrivacyMode)}
                        className={cn(
                          'mt-3 flex w-fit items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors',
                          aiPrivacyMode
                            ? 'border-green-500/50 bg-green-500/20 text-green-500'
                            : 'border-input bg-muted text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {aiPrivacyMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        {aiPrivacyMode ? 'On' : 'Off'}
                      </button>
                    </div>

                    <div className={sectionClass}>
                      <span className="text-sm font-medium">{t('settings.ai.shortcut')}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{t('settings.ai.shortcutDesc')}</span>
                      <div className="mt-3 flex w-fit rounded-md border border-input bg-background/50 p-1">
                        {[
                          { id: 'enter', label: 'Enter' },
                          { id: 'ctrlEnter', label: 'Ctrl + Enter' },
                        ].map((shortcut) => (
                          <button
                            key={shortcut.id}
                            type="button"
                            onClick={() => setAiSendShortcut(shortcut.id as 'enter' | 'ctrlEnter')}
                            className={cn(
                              'rounded-sm px-4 py-1.5 text-xs font-medium transition-colors',
                              aiSendShortcut === shortcut.id
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                            )}
                          >
                            {shortcut.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-transparent animate-in fade-in duration-300">
      <div className="flex h-full w-56 flex-col border-r border-border/60 bg-card/45 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-border/60 p-3.5">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold">{t('settings.title')}</span>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2.5">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === item.id
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl animate-in slide-in-from-right-4 duration-300">
            <div className="mb-4">
              <h2 className="text-xl font-bold tracking-tight">{sidebarItems.find((item) => item.id === activeTab)?.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text.appearanceDesc}</p>
            </div>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
