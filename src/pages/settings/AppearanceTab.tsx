import { Slider } from '../../components/ui/slider';
import { cn } from '../../lib/utils';
import { TERMINAL_FONT_OPTIONS, UI_FONT_OPTIONS } from '../../shared/fontStacks';
import { accentColors, type AccentColorId, type AppearanceMode } from '../../shared/themes';
import { useSettingsStore } from '../../store/settingsStore';
import { MAX_RADIUS_SCALE, MIN_RADIUS_SCALE, useThemeStore } from '../../store/themeStore';
import { useTranslation } from '../../hooks/useTranslation';
import { FieldLabel } from './controls';
import { FontPicker } from './FontPicker';

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

export function AppearanceTab() {
  const { t } = useTranslation();
  const { appearance, accentColorId, radiusScale, setAppearance, setAccentColor, setRadiusScale } = useThemeStore();
  const { uiFontFamily, setUiFontFamily, terminalFontFamily, setTerminalFontFamily } = useSettingsStore();

  return (

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
}
