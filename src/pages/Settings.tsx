import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  ComputerTerminal01Icon,
  FolderOpenIcon,
  GithubIcon,
  PaintBoardIcon,
  Settings01Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
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
import { MAX_RADIUS_SCALE, MIN_RADIUS_SCALE, useThemeStore } from '../store/themeStore';
import { useTranslation } from '../hooks/useTranslation';

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
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
        checked ? 'border-primary/50 bg-primary' : 'border-border bg-foreground/10',
      )}
    >
      <span className={cn(
        'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-primary-foreground transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0',
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [openAbove, setOpenAbove] = useState(false);
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
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportGap = 12;
    const menuGap = 8;
    const availableBelow = window.innerHeight - rect.bottom - viewportGap - menuGap;
    const availableAbove = rect.top - viewportGap - menuGap;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const maxHeight = Math.max(180, Math.min(340, openAbove ? availableAbove : availableBelow));
    const width = Math.min(rect.width, window.innerWidth - viewportGap * 2);
    const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap);

    setOpenAbove(openAbove);
    setMenuStyle(openAbove
      ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + menuGap }
      : { left, width, maxHeight, top: rect.bottom + menuGap });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background/55 px-3 text-left transition-colors',
          'hover:border-foreground/20 hover:bg-background/75 focus-visible:outline-none focus-visible:border-foreground/35',
          open && 'border-foreground/30',
        )}
      >
        <span className="truncate text-sm font-medium" style={{ fontFamily: selected.value }}>{selected.label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={cn(
            'glass-panel fixed z-[100] overflow-y-auto rounded-xl border-border/80 bg-popover/95 p-1.5 backdrop-blur-xl',
            'animate-in fade-in-0 zoom-in-95 duration-150 ease-out',
            openAbove ? 'origin-bottom slide-in-from-bottom-2' : 'origin-top slide-in-from-top-2',
          )}
          style={menuStyle}
        >
          {groups.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
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
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
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
      , document.body)}
    </div>
  );
}

function SettingsCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel overflow-visible rounded-2xl">
      <div className="border-b border-border/55 px-4 py-3.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
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

function ThemePreview({ mode }: { mode: AppearanceMode }) {
  const background = mode === 'light'
    ? 'bg-[#f1f1f2]'
    : mode === 'dark'
      ? 'bg-[#29292b]'
      : 'bg-[linear-gradient(90deg,#dedee0_0_50%,#343436_50%)]';
  const surface = mode === 'light'
    ? 'bg-white'
    : mode === 'dark'
      ? 'bg-[#121214]'
      : 'bg-[linear-gradient(90deg,#f7f7f8_0_50%,#171719_50%)]';
  const muted = mode === 'light'
    ? 'bg-black/10'
    : mode === 'dark'
      ? 'bg-white/20'
      : 'bg-[linear-gradient(90deg,rgba(0,0,0,.12)_0_50%,rgba(255,255,255,.22)_50%)]';

  return (
    <div className={cn('relative aspect-[1.55] overflow-hidden rounded-xl', background)} aria-hidden="true">
      <div className="absolute inset-x-[18%] top-[22%] space-y-1.5">
        <div className={cn('mx-auto h-1.5 w-2/5 rounded-full', muted)} />
        <div className={cn('mx-auto h-1.5 w-3/5 rounded-full opacity-70', muted)} />
      </div>
      <div className={cn('absolute inset-x-[8%] bottom-[-10%] top-[38%] overflow-hidden rounded-t-xl border border-black/5', surface)}>
        <div className="space-y-3 p-3">
          {[58, 76, 66].map((width) => (
            <div key={width} className={cn('space-y-1.5 border-b pb-2.5', mode === 'dark' ? 'border-white/[0.07]' : 'border-black/[0.055]')}>
              <div className={cn('h-1.5 rounded-full', muted)} style={{ width: `${width}%` }} />
              <div className={cn('h-1 w-2/5 rounded-full opacity-55', muted)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [appVersion, setAppVersion] = useState('1.0.12');

  const {
    appearance,
    accentColorId,
    radiusScale,
    setAppearance,
    setAccentColor,
    setRadiusScale,
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
    autoReconnect,
    setAutoReconnect,
  } = useSettingsStore();

  const copy = {
    title: t('settings.title'),
    app: t('settings.tabs.app'),
    appearance: t('settings.tabs.appearance'),
    terminal: t('settings.tabs.terminal'),
  };

  useEffect(() => {
    window.electron.getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: IconSvgElement }> = [
    { id: 'app', label: copy.app, description: '', icon: Settings01Icon },
    { id: 'appearance', label: copy.appearance, description: '', icon: PaintBoardIcon },
    { id: 'terminal', label: copy.terminal, description: t('settings.terminal.fontFamilyDesc'), icon: ComputerTerminal01Icon },
  ];

  const tabGroups: Array<{ label: string; items: typeof tabs }> = [{ label: '', items: tabs }];

  const languageOptions = [
    { label: '中文', value: 'zh' },
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
    { label: '한국어', value: 'ko' },
    { label: 'Italiano', value: 'it' },
  ];

  const renderAppearance = () => (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold">{t('settings.appearance.theme')}</h3>
        <div className="grid grid-cols-3 gap-4">
          {([
            { id: 'system', label: t('common.system') },
            { id: 'light', label: t('common.light') },
            { id: 'dark', label: t('common.dark') },
          ] as Array<{ id: AppearanceMode; label: string }>).map((option) => (
            <button key={option.id} type="button" onClick={() => setAppearance(option.id)} className="min-w-0 text-center">
              <div className={cn(
                'rounded-[calc(14px*var(--radius-scale))] border-2 p-0.5 transition-colors',
                appearance === option.id ? 'border-foreground' : 'border-transparent hover:border-border',
              )}>
                <ThemePreview mode={option.id} />
              </div>
              <div className={cn('mt-2 text-xs', appearance === option.id ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {option.label}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="overflow-visible rounded-2xl border border-border/70 bg-card/35">
        <div className="flex min-h-14 items-center justify-between gap-5 border-b border-border/60 px-4 py-3">
          <FieldLabel title={t('settings.appearance.accentColor')} />
          <div className="flex max-w-[340px] flex-wrap justify-end gap-2">
            {Object.values(accentColors).map((accent) => (
              <button
                key={accent.id}
                type="button"
                onClick={() => setAccentColor(accent.id as AccentColorId)}
                className={cn(
                  'h-5 w-5 rounded-full border border-black/10 transition-[outline-color]',
                  accentColorId === accent.id && 'outline outline-2 outline-offset-2 outline-foreground/70',
                )}
                style={{ background: `hsl(${accent.color})` }}
                title={accent.name}
                aria-label={accent.name}
                aria-pressed={accentColorId === accent.id}
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-5 border-b border-border/60 px-4 py-3">
          <FieldLabel title={t('settings.appearance.cornerRadius')} description={t('settings.appearance.cornerRadiusDesc')} />
          <div className="flex w-[260px] max-w-[58%] shrink-0 items-center gap-3">
            <div className="h-7 w-7 shrink-0 rounded-xl border border-border bg-foreground/[0.09] transition-[border-radius] duration-200 ease-out" aria-hidden="true" />
            <Slider
              min={MIN_RADIUS_SCALE}
              max={MAX_RADIUS_SCALE}
              step={0.05}
              value={radiusScale}
              onChange={setRadiusScale}
              className="flex-1"
              aria-label={t('settings.appearance.cornerRadius')}
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(radiusScale * 100)}%
            </span>
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-5 border-b border-border/60 px-4 py-3">
          <FieldLabel title={t('settings.appearance.font')} />
          <div className="w-[260px] max-w-[58%]">
            <FontPicker value={uiFontFamily} options={UI_FONT_OPTIONS} onChange={setUiFontFamily} />
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-5 px-4 py-3">
          <FieldLabel title={t('settings.terminal.fontFamily')} />
          <div className="w-[260px] max-w-[58%]">
            <FontPicker value={terminalFontFamily} options={TERMINAL_FONT_OPTIONS} onChange={setTerminalFontFamily} />
          </div>
        </div>
      </section>
    </div>
  );

  const renderTerminal = () => (
    <div className="max-w-[680px] space-y-3">
      <SettingsCard
        title={t('settings.terminal.fontFamily')}
        description={t('settings.terminal.fontFamilyDesc')}
      >
        <FontPicker value={terminalFontFamily} options={TERMINAL_FONT_OPTIONS} onChange={setTerminalFontFamily} />
        <div className="grid max-w-[480px] grid-cols-3 gap-3">
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.terminal.fontSize')}</span>
            <Input type="number" min={10} max={24} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.terminal.lineHeight')}</span>
            <Input type="number" min={1} max={2} step={0.1} value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.terminal.letterSpacing')}</span>
            <Input type="number" min={-5} max={5} step={0.5} value={letterSpacing} onChange={(event) => setLetterSpacing(Number(event.target.value))} />
          </label>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.terminal.rendering')}
        description={t('settings.terminal.rendererTypeDesc')}
      >
        <div className="flex items-center justify-between gap-6">
          <FieldLabel title={t('settings.terminal.cursorStyle')} />
          <div className="flex rounded-xl border border-border/60 bg-background/45 p-1">
            {(['block', 'underline', 'bar'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setCursorStyle(style)}
                className={cn('rounded-lg px-3 py-1.5 text-xs capitalize transition-colors', cursorStyle === style ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
              >{t(`common.${style}`)}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.terminal.cursorBlink')} />
          <ToggleSwitch checked={cursorBlink} onChange={setCursorBlink} />
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.terminal.brightBold')} />
          <ToggleSwitch checked={brightBold} onChange={setBrightBold} />
        </div>
        <div className="grid max-w-[520px] grid-cols-2 gap-3 border-t border-border/45 pt-4">
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.terminal.rendererType')}</span>
            <Select value={rendererType} onChange={(value) => setRendererType(value as 'canvas' | 'webgl')} options={[{ label: 'Canvas', value: 'canvas' }, { label: 'WebGL', value: 'webgl' }]} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.terminal.scrollback')}</span>
            <Input type="number" min={1000} max={100000} step={1000} value={scrollback} onChange={(event) => setScrollback(Number(event.target.value))} />
          </label>
        </div>
      </SettingsCard>
    </div>
  );

  const renderApp = () => (
    <div className="space-y-3">
      <SettingsCard
        title={t('settings.tabs.app')}
        description={t('settings.appearance.languageDesc')}
      >
        <div className="flex items-center justify-between gap-6">
          <FieldLabel title={t('settings.application.restoreLast')} description={t('settings.application.restoreLastDesc')} />
          <ToggleSwitch checked={autoReconnect} onChange={setAutoReconnect} />
        </div>
        <div className="grid grid-cols-[1fr_220px] items-center gap-6 border-t border-border/45 pt-5">
          <FieldLabel title={t('settings.appearance.language')} />
          <Select value={language} onChange={(value) => setLanguage(value as Language)} options={languageOptions} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Reflex"
        description={t('settings.about.title')}
      >
        <div className="flex items-center gap-4 rounded-2xl border border-border/55 bg-background/38 p-4">
          <img src={`${import.meta.env.BASE_URL}tray-icon.png`} alt="Reflex" className="h-12 w-12 rounded-2xl border border-border/60 object-cover" />
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

        <div className="flex items-center justify-between gap-5 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.about.logs')} description={t('settings.about.logsDesc')} />
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => void window.electron.logReveal()}>
            <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
            {t('settings.about.openLogs')}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );

  const active = tabs.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex h-full min-w-0 gap-2 overflow-hidden p-2">
      <aside className="glass-panel flex w-[196px] shrink-0 flex-col rounded-2xl border-border/65 bg-card/72 px-2 py-3">
        <div className="px-2 pb-3">
          <div className="text-sm font-semibold tracking-tight">{copy.title}</div>
        </div>

        <nav aria-label={copy.title}>
          {tabGroups.map((group, groupIndex) => (
            <div
              key={group.label}
              className={cn(groupIndex > 0 && 'mt-2 border-t border-border/70 pt-3')}
            >
              {group.label && <div className="px-2 pb-1.5 text-[10px] font-medium text-muted-foreground">{group.label}</div>}
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
                        'group flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors duration-150',
                        selected
                          ? 'bg-foreground/[0.09] text-foreground'
                          : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                      )}
                    >
                      <HugeiconsIcon
                        icon={tab.icon}
                        className={cn('h-4 w-4 shrink-0 transition-colors', selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}
                        strokeWidth={1.8}
                      />
                      <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em]">{active.label}</h2>
              {active.description && <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>}
            </div>
          </div>
          {activeTab === 'appearance' && renderAppearance()}
          {activeTab === 'terminal' && renderTerminal()}
          {activeTab === 'app' && renderApp()}
          <div className="h-4" />
        </div>
      </main>
    </div>
  );
}
