import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon, CheckmarkCircle02Icon, Loading02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import { errorMessage } from '../../lib/errors';
import { useTranslation } from '../../hooks/useTranslation';
import { AGENT_MODES, MODE_HINT, MODE_LABEL } from '../../components/agent/modes';
import { PROVIDER_PRESETS, type AgentConfigView } from '../../shared/agent';
import { FieldLabel, SettingsCard } from './controls';

type TestState = { state: 'idle' } | { state: 'running' } | { state: 'ok' } | { state: 'failed'; error: string };

export function AgentTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<TestState>({ state: 'idle' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.electron.agentConfigGet().then(setConfig).catch(() => undefined);
  }, []);

  if (!config) return null;

  const preset = PROVIDER_PRESETS.find(
    (item) => item.kind === config.kind && item.baseUrl === config.baseUrl,
  );

  const patch = (next: Partial<AgentConfigView>) => {
    setConfig({ ...config, ...next });
    setTest({ state: 'idle' });
    setSaved(false);
  };

  // 'custom' is a rendered option rather than a real preset: without it the Select finds
  // no match for a hand-edited address and falls back to showing its placeholder, which
  // reads as "nothing is configured" when in fact something is.
  const presetOptions = [
    ...PROVIDER_PRESETS.map((item) => ({ label: item.label, value: item.id })),
    { label: t('settings.agent.custom'), value: 'custom' },
  ];

  const applyPreset = (id: string) => {
    const chosen = PROVIDER_PRESETS.find((item) => item.id === id);
    if (!chosen) return;
    // The model comes with the preset but stays editable; Ark names one per deployment,
    // so it ships blank rather than with a guess that would fail on the first request.
    patch({ kind: chosen.kind, baseUrl: chosen.baseUrl, model: chosen.model });
  };

  const save = async () => {
    const updated = await window.electron.agentConfigSet({
      kind: config.kind,
      baseUrl: config.baseUrl,
      model: config.model,
      mode: config.mode,
      // Left out when untouched, so saving a model change never clears a stored key.
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setConfig(updated);
    setApiKey('');
    setSaved(true);
    setTest({ state: 'idle' });
  };

  const runTest = async () => {
    setTest({ state: 'running' });
    try {
      const result = await window.electron.agentTest();
      setTest(result.ok ? { state: 'ok' } : { state: 'failed', error: result.error });
    } catch (error) {
      setTest({ state: 'failed', error: errorMessage(error, 'Failed') });
    }
  };

  return (
    <div className="space-y-3">
      <SettingsCard title={t('settings.agent.title')} description={t('settings.agent.desc')}>
        <div className="grid grid-cols-[1fr_220px] items-center gap-6">
          <FieldLabel title={t('settings.agent.provider')} />
          <Select
            value={preset?.id ?? 'custom'}
            onChange={applyPreset}
            options={presetOptions}
          />
        </div>

        <div className="grid grid-cols-[1fr_320px] items-center gap-6 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.agent.baseUrl')} />
          <Input
            value={config.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-[1fr_320px] items-center gap-6 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.agent.model')} />
          <Input
            value={config.model}
            onChange={(event) => patch({ model: event.target.value })}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-[1fr_320px] items-start gap-6 border-t border-border/45 pt-4">
          <FieldLabel title={t('settings.agent.apiKey')} description={t('settings.agent.keyNote')} />
          <div className="space-y-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setSaved(false);
                setTest({ state: 'idle' });
              }}
              spellCheck={false}
              placeholder={config.hasKey
                ? t('settings.agent.apiKeyPlaceholder')
                : t('settings.agent.apiKeyNew')}
              className="font-mono text-xs"
            />
            {config.hasKey && !apiKey && (
              <p className="text-[11px] text-muted-foreground">
                {t('settings.agent.apiKeyStored', { hint: config.keyHint })}
              </p>
            )}
            {preset && (
              <button
                type="button"
                onClick={() => void window.electron.openExternal(preset.console)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('settings.agent.getKey')}
                <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/45 pt-4">
          <Button onClick={() => void save()}>{t('settings.agent.save')}</Button>
          <Button variant="outline" className="gap-2" onClick={() => void runTest()} disabled={test.state === 'running'}>
            {test.state === 'running' && (
              <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
            )}
            {test.state === 'running' ? t('settings.agent.testing') : t('settings.agent.test')}
          </Button>

          {saved && <span className="text-[11px] text-muted-foreground">{t('settings.agent.saved')}</span>}
          {test.state === 'ok' && (
            <span className="flex items-center gap-1 text-[11px] text-primary">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
              {t('settings.agent.testOk')}
            </span>
          )}
        </div>

        {test.state === 'failed' && (
          <p className="break-all rounded-xl bg-rose-500/[0.07] px-3 py-2 text-[11px] leading-5 text-rose-500">
            {test.error}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('settings.agent.permission')}
        description={t('settings.agent.permissionDesc')}
      >
        <div className="space-y-1.5">
          {AGENT_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                patch({ mode: option });
                void window.electron.agentConfigSet({ mode: option });
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                config.mode === option
                  ? 'border-primary/45 bg-primary/[0.06]'
                  : 'border-border/55 hover:bg-foreground/[0.03]',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-[4px] transition-colors',
                config.mode === option ? 'border-primary' : 'border-border',
              )} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(MODE_LABEL[option])}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {t(MODE_HINT[option])}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
