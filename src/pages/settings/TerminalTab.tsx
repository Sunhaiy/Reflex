import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';

import { cn } from '../../lib/utils';
import { TERMINAL_FONT_OPTIONS } from '../../shared/fontStacks';
import type { Language } from '../../shared/locales';

import { useSettingsStore } from '../../store/settingsStore';

import { useTranslation } from '../../hooks/useTranslation';
import { FieldLabel, SettingsCard, ToggleSwitch } from './controls';
import { FontPicker } from './FontPicker';

export function TerminalTab() {
  const { t } = useTranslation();
  const {
    terminalFontFamily, setTerminalFontFamily,
    fontSize, setFontSize,
    lineHeight, setLineHeight,
    letterSpacing, setLetterSpacing,
    cursorStyle, setCursorStyle,
    cursorBlink, setCursorBlink,
    rendererType, setRendererType,
    scrollback, setScrollback,
    brightBold, setBrightBold,
  } = useSettingsStore();

  return (

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
}
