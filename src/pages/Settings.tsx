import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  ComputerTerminal01Icon,
  ComputerIcon,
  GithubIcon,
  Moon02Icon,
  PaintBoardIcon,
  Settings01Icon,
  Sun03Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { cn } from '../lib/utils';
import {
  TERMINAL_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  type FontCategory,
  type FontOption,
} from '../shared/fontStacks';
import type { Language } from '../shared/locales';
import { accentColors, type AccentColorId, type AppearanceMode } from '../shared/themes';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';

type SettingsTab = 'app' | 'appearance' | 'terminal';

const categoryLabels: Record<FontCategory, string> = {
  sans: 'Sans',
  mono: 'Mono',
  serif: 'Serif',
};

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-colors',
        checked ? 'border-primary/50 bg-primary' : 'border-border bg-foreground/10',
      )}
    >
      <span className={cn(
        'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-[21px]' : 'translate-x-0.5',
      )} />
    </button>
  );
}

function FontPicker({ value, options, onChange }: {
  value: string;
  options: FontOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((font) => font.value === value) ?? options[0];
  const groups = useMemo(() => ['sans', 'mono', 'serif']
    .map((category) => ({
      category: category as FontCategory,
      fonts: options.filter((font) => font.category === category),
    }))
    .filter((group) => group.fonts.length > 0), [options]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-11 w-full items-center justify-between rounded-xl border border-input bg-background/55 px-3.5 text-left transition-all',
          'hover:border-foreground/20 hover:bg-background/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          open && 'border-primary/45 ring-2 ring-primary/15',
        )}
      >
        <span className="truncate text-sm font-medium" style={{ fontFamily: selected.value }}>{selected.label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="glass-panel absolute left-0 right-0 top-[calc(100%+8px)] z-40 max-h-[340px] overflow-y-auto rounded-2xl p-2 shadow-2xl">
          {groups.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <div className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                {categoryLabels[group.category]}
              </div>
              <div className="space-y-0.5">
                {group.fonts.map((font) => {
                  const active = font.value === value;
                  return (
                    <button
                      key={font.label}
                      type="button"
                      onClick={() => {
                        onChange(font.value);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-primary/12 text-primary' : 'hover:bg-foreground/[0.055]',
                      )}
                    >
                      <span className="flex-1 text-[15px] font-medium" style={{ fontFamily: font.value }}>{font.label}</span>
                      {active && <HugeiconsIcon icon={Tick01Icon} className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsCard({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel overflow-visible rounded-3xl">
      <div className="border-b border-border/55 px-6 py-5">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-5 p-6">{children}</div>
    </section>
  );
}

function FieldLabel({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>}
    </div>
  );
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [appVersion, setAppVersion] = useState('1.0.12');

  const {
    appearance,
    resolvedAppearance,
    accentColorId,
    setAppearance,
    setAccentColor,
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
    autoReconnect,
    setAutoReconnect,
  } = useSettingsStore();

  const isZh = language === 'zh';
  const copy = {
    title: isZh ? '设置' : 'Settings',
    subtitle: isZh ? '让 Reflex 更符合你的工作方式' : 'Make Reflex feel like your own workspace',
    app: isZh ? '应用' : 'Application',
    appDesc: isZh ? '行为与项目信息' : 'Behavior and project',
    appearance: isZh ? '外观' : 'Appearance',
    appearanceDesc: isZh ? '界面、字体与配色' : 'Interface, type, and color',
    terminal: isZh ? '终端' : 'Terminal',
    terminalDesc: isZh ? '显示、光标与性能' : 'Display, cursor, and performance',
  };

  useEffect(() => {
    window.electron.getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: IconSvgElement }> = [
    { id: 'app', label: copy.app, description: copy.appDesc, icon: Settings01Icon },
    { id: 'appearance', label: copy.appearance, description: copy.appearanceDesc, icon: PaintBoardIcon },
    { id: 'terminal', label: copy.terminal, description: copy.terminalDesc, icon: ComputerTerminal01Icon },
  ];

  const tabGroups: Array<{ label: string; items: typeof tabs }> = [
    {
      label: isZh ? '常规' : 'Overview',
      items: tabs.filter((tab) => tab.id !== 'terminal'),
    },
    {
      label: isZh ? '工作区' : 'Workspace',
      items: tabs.filter((tab) => tab.id === 'terminal'),
    },
  ];

  const languageOptions = [
    { label: '中文', value: 'zh' },
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
    { label: '한국어', value: 'ko' },
    { label: 'Italiano', value: 'it' },
  ];

  const renderAppearance = () => (
    <div className="space-y-5">
      <SettingsCard
        title={isZh ? '界面外观' : 'Interface appearance'}
        description={isZh ? '移除旧主题，使用一套统一、中性的雾面设计系统。' : 'One neutral frosted design system, without legacy themes.'}
      >
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: 'system', label: isZh ? '跟随系统' : 'System', icon: ComputerIcon },
            { id: 'light', label: isZh ? '浅色' : 'Light', icon: Sun03Icon },
            { id: 'dark', label: isZh ? '深色' : 'Dark', icon: Moon02Icon },
          ] as Array<{ id: AppearanceMode; label: string; icon: IconSvgElement }>).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAppearance(option.id)}
              className={cn(
                'surface-hover relative flex min-h-[112px] flex-col justify-between rounded-2xl border p-4 text-left',
                appearance === option.id
                  ? 'border-primary/45 bg-primary/[0.075] ring-1 ring-primary/20'
                  : 'border-border/65 bg-background/42',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/60">
                  <HugeiconsIcon icon={option.icon} className="h-[18px] w-[18px]" />
                </span>
                {appearance === option.id && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <HugeiconsIcon icon={Tick01Icon} className="h-3 w-3" />
                  </span>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold">{option.label}</div>
                {option.id === 'system' && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {isZh ? `当前为${resolvedAppearance === 'dark' ? '深色' : '浅色'}` : `Currently ${resolvedAppearance}`}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title={isZh ? '强调色' : 'Accent color'}
        description={isZh ? '来自 shadcn/Tailwind 的基础色板，只用于状态、焦点和关键操作。' : 'A shadcn/Tailwind palette used only for state, focus, and key actions.'}
      >
        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6">
          {(Object.values(accentColors)).map((accent) => (
            <button
              key={accent.id}
              type="button"
              onClick={() => setAccentColor(accent.id as AccentColorId)}
              className={cn(
                'flex min-h-[74px] flex-col items-center justify-center gap-2 rounded-2xl border transition-all',
                accentColorId === accent.id
                  ? 'border-foreground/25 bg-foreground/[0.065] shadow-sm'
                  : 'border-border/60 bg-background/36 hover:border-foreground/15 hover:bg-foreground/[0.035]',
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full shadow-sm" style={{ background: `hsl(${accent.color})` }}>
                {accentColorId === accent.id && <HugeiconsIcon icon={Tick01Icon} className="h-3.5 w-3.5" color={`hsl(${accent.foreground})`} />}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">{accent.name}</span>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title={isZh ? '界面字体' : 'Interface font'}
        description={isZh ? 'Sans、Mono 和 Serif 字体均为本地资源，离线也能完整显示。' : 'Sans, Mono, and Serif families are bundled for full offline use.'}
      >
        <FontPicker value={uiFontFamily} options={UI_FONT_OPTIONS} onChange={setUiFontFamily} />
        <div className="rounded-2xl border border-border/55 bg-background/38 px-5 py-4" style={{ fontFamily: uiFontFamily }}>
          <div className="text-lg font-semibold tracking-tight">Reflex Remote Workspace</div>
          <div className="mt-1.5 text-sm text-muted-foreground">连接、探索、保持专注。The quick brown fox jumps over 0123456789.</div>
        </div>
      </SettingsCard>
    </div>
  );

  const renderTerminal = () => (
    <div className="space-y-5">
      <SettingsCard
        title={isZh ? '字体与排版' : 'Type and rhythm'}
        description={isZh ? '终端字体单独设置，不会影响应用界面。' : 'Terminal typography is independent from the app interface.'}
      >
        <FontPicker value={terminalFontFamily} options={TERMINAL_FONT_OPTIONS} onChange={setTerminalFontFamily} />
        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{isZh ? '字号' : 'Size'}</span>
            <Input type="number" min={10} max={24} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{isZh ? '行高' : 'Line height'}</span>
            <Input type="number" min={1} max={2} step={0.1} value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{isZh ? '字距' : 'Spacing'}</span>
            <Input type="number" min={-5} max={5} step={0.5} value={letterSpacing} onChange={(event) => setLetterSpacing(Number(event.target.value))} />
          </label>
        </div>
      </SettingsCard>

      <SettingsCard
        title={isZh ? '光标与渲染' : 'Cursor and rendering'}
        description={isZh ? '调整输入反馈与长时间会话的性能。' : 'Tune input feedback and long-session performance.'}
      >
        <div className="flex items-center justify-between gap-6">
          <FieldLabel title={isZh ? '光标样式' : 'Cursor style'} />
          <div className="flex rounded-xl border border-border/60 bg-background/45 p-1">
            {(['block', 'underline', 'bar'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setCursorStyle(style)}
                className={cn('rounded-lg px-3 py-1.5 text-xs capitalize transition-colors', cursorStyle === style ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
              >{style}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-border/45 pt-5">
          <FieldLabel title={isZh ? '光标闪烁' : 'Blinking cursor'} description={isZh ? '在等待输入时保持轻微动态反馈。' : 'Keep a subtle signal while waiting for input.'} />
          <ToggleSwitch checked={cursorBlink} onChange={setCursorBlink} />
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-border/45 pt-5">
          <FieldLabel title={isZh ? '高亮文字加粗' : 'Bold bright colors'} />
          <ToggleSwitch checked={brightBold} onChange={setBrightBold} />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border/45 pt-5">
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{isZh ? '渲染方式' : 'Renderer'}</span>
            <Select value={rendererType} onChange={(value) => setRendererType(value as 'canvas' | 'webgl')} options={[{ label: 'Canvas', value: 'canvas' }, { label: 'WebGL', value: 'webgl' }]} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{isZh ? '回滚行数' : 'Scrollback'}</span>
            <Input type="number" min={1000} max={100000} step={1000} value={scrollback} onChange={(event) => setScrollback(Number(event.target.value))} />
          </label>
        </div>
        <div className="border-t border-border/45 pt-5">
          <FieldLabel title={isZh ? '终端铃声' : 'Terminal bell'} />
          <div className="mt-3 flex w-fit rounded-xl border border-border/60 bg-background/45 p-1">
            {([
              { id: 'none', label: isZh ? '关闭' : 'Off' },
              { id: 'visual', label: isZh ? '视觉' : 'Visual' },
              { id: 'sound', label: isZh ? '声音' : 'Sound' },
            ] as const).map((item) => (
              <button key={item.id} type="button" onClick={() => setBellStyle(item.id)} className={cn('rounded-lg px-3 py-1.5 text-xs transition-colors', bellStyle === item.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{item.label}</button>
            ))}
          </div>
        </div>
      </SettingsCard>
    </div>
  );

  const renderApp = () => (
    <div className="space-y-5">
      <SettingsCard
        title={isZh ? '应用行为' : 'Application behavior'}
        description={isZh ? '控制启动恢复与界面语言。' : 'Control session recovery and interface language.'}
      >
        <div className="flex items-center justify-between gap-6">
          <FieldLabel title={isZh ? '自动恢复上次连接' : 'Restore last connection'} description={isZh ? '启动后自动重连最近使用的服务器。' : 'Reconnect to the most recently used server on launch.'} />
          <ToggleSwitch checked={autoReconnect} onChange={setAutoReconnect} />
        </div>
        <div className="grid grid-cols-[1fr_220px] items-center gap-6 border-t border-border/45 pt-5">
          <FieldLabel title={isZh ? '界面语言' : 'Interface language'} />
          <Select value={language} onChange={(value) => setLanguage(value as Language)} options={languageOptions} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Reflex"
        description={isZh ? '轻量、专注的 SSH 工作台。' : 'A focused, lightweight SSH workspace.'}
      >
        <div className="flex items-center gap-4 rounded-2xl border border-border/55 bg-background/38 p-4">
          <img src={`${import.meta.env.BASE_URL}tray-icon.png`} alt="Reflex" className="h-12 w-12 rounded-2xl border border-border/60 object-cover shadow-sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Reflex {appVersion}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">Electron · React · Shadcn tokens · Hugeicons</div>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => window.electron.openExternal('https://github.com/Sunhaiy/Reflex')}>
            <HugeiconsIcon icon={GithubIcon} className="h-4 w-4" />
            GitHub
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SettingsCard>
    </div>
  );

  const active = tabs.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex h-full min-w-0 gap-3 overflow-hidden p-3">
      <aside className="glass-panel flex w-[232px] shrink-0 flex-col rounded-[30px] border-border/65 bg-card/72 px-3 py-4 shadow-[0_20px_60px_-36px_rgba(0,0,0,0.72)]">
        <div className="px-3 pb-4">
          <div className="text-[15px] font-semibold tracking-tight">{copy.title}</div>
          <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{copy.subtitle}</div>
        </div>

        <nav aria-label={copy.title}>
          {tabGroups.map((group, groupIndex) => (
            <div
              key={group.label}
              className={cn(groupIndex > 0 && 'mt-3 border-t border-border/70 pt-4')}
            >
              <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((tab) => {
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'group flex h-11 w-full items-center gap-3 rounded-[14px] px-3.5 text-left transition-[background-color,color,transform] duration-200',
                        selected
                          ? 'bg-foreground/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]'
                          : 'text-muted-foreground hover:translate-x-0.5 hover:bg-foreground/[0.045] hover:text-foreground',
                      )}
                    >
                      <HugeiconsIcon
                        icon={tab.icon}
                        className={cn('h-5 w-5 shrink-0 transition-colors', selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}
                        strokeWidth={1.8}
                      />
                      <span className="truncate text-[14px] font-medium tracking-[-0.01em]">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-border/70 px-3 pt-4 text-[10px] leading-4 text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.45)]" />
            <span>{isZh ? '所有设置都会立即生效并自动保存。' : 'Changes apply instantly and save automatically.'}</span>
          </div>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-3xl border border-border/40 bg-background/18">
        <div className="mx-auto w-full max-w-[980px] px-8 py-7">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.025em]">{active.label}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{active.description}</p>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-border/55 bg-card/45 px-3 py-1.5 text-[10px] text-muted-foreground lg:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {isZh ? '自动保存' : 'Autosaved'}
            </div>
          </div>
          {activeTab === 'appearance' && renderAppearance()}
          {activeTab === 'terminal' && renderTerminal()}
          {activeTab === 'app' && renderApp()}
          <div className="h-8" />
        </div>
      </main>
    </div>
  );
}
