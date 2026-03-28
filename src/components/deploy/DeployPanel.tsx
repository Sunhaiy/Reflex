import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Globe,
  Loader2,
  Play,
  Rocket,
  Server,
  Square,
} from 'lucide-react';
import {
  DeployDraft,
  DeployRun,
  DeployStepRuntime,
  DeploymentStrategyId,
} from '../../shared/deployTypes';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface DeployPanelProps {
  connectionId: string;
  profileId: string;
  host: string;
  connectionName?: string;
  isConnected: boolean;
}

const STEP_TRANSLATION_KEYS: Record<string, string> = {
  scan: 'deploy.steps.scan',
  pack: 'deploy.steps.pack',
  prepare: 'deploy.steps.prepare',
  upload: 'deploy.steps.upload',
  extract: 'deploy.steps.extract',
  env: 'deploy.steps.env',
  'fix-ownership': 'deploy.steps.fix-ownership',
  'install-node': 'deploy.steps.install-node',
  'install-nginx': 'deploy.steps.install-nginx',
  'install-python': 'deploy.steps.install-python',
  install: 'deploy.steps.install',
  'install-postgres': 'deploy.steps.install-postgres',
  'configure-postgres': 'deploy.steps.configure-postgres',
  'provision-postgres': 'deploy.steps.provision-postgres',
  'wait-postgres': 'deploy.steps.wait-postgres',
  build: 'deploy.steps.build',
  'snapshot-current': 'deploy.steps.snapshot-current',
  switch: 'deploy.steps.switch',
  systemd: 'deploy.steps.systemd',
  'systemd-reload': 'deploy.steps.systemd-reload',
  'service-verify': 'deploy.steps.service-verify',
  'nginx-config': 'deploy.steps.nginx-config',
  'nginx-reload': 'deploy.steps.nginx-reload',
  verify: 'deploy.steps.verify',
  output: 'deploy.steps.output',
};

function parseEnvText(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const idx = normalized.indexOf('=');
      if (idx === -1) return acc;
      const key = normalized.slice(0, idx).trim();
      const value = normalized.slice(idx + 1);
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function envVarsToText(envVars?: Record<string, string>) {
  return Object.entries(envVars || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function useStrategyOptions(t: (key: string) => string) {
  return useMemo<{ id: '' | DeploymentStrategyId; label: string }[]>(
    () => [
      { id: '', label: t('deploy.options.auto') },
      { id: 'static-nginx', label: t('deploy.options.staticNginx') },
      { id: 'node-systemd', label: t('deploy.options.nodeSystemd') },
      { id: 'next-standalone', label: t('deploy.options.nextStandalone') },
      { id: 'dockerfile', label: t('deploy.options.dockerfile') },
      { id: 'docker-compose', label: t('deploy.options.dockerCompose') },
      { id: 'python-systemd', label: t('deploy.options.pythonSystemd') },
    ],
    [t],
  );
}

function formatRunStatus(t: (key: string) => string, run?: DeployRun | null) {
  if (!run) return t('deploy.runStatus.idle');
  return `${t(`deploy.runStatus.${run.status}`)} / ${t(`deploy.phases.${run.phase}`)}`;
}

function translateStepLabel(t: (key: string) => string, step: DeployStepRuntime) {
  const key = STEP_TRANSLATION_KEYS[step.id];
  if (!key) return step.label;
  const translated = t(key);
  return translated === key ? step.label : translated;
}

function translateStrategy(t: (key: string) => string, strategyId: DeploymentStrategyId) {
  const keyMap: Record<DeploymentStrategyId, string> = {
    'static-nginx': 'deploy.options.staticNginx',
    'node-systemd': 'deploy.options.nodeSystemd',
    'next-standalone': 'deploy.options.nextStandalone',
    dockerfile: 'deploy.options.dockerfile',
    'docker-compose': 'deploy.options.dockerCompose',
    'python-systemd': 'deploy.options.pythonSystemd',
  };
  return t(keyMap[strategyId]);
}

export function DeployPanel({
  connectionId,
  profileId,
  host,
  connectionName,
  isConnected,
}: DeployPanelProps) {
  const { t } = useTranslation();
  const strategyOptions = useStrategyOptions(t);
  const [projectRoot, setProjectRoot] = useState('');
  const [appName, setAppName] = useState('');
  const [domain, setDomain] = useState('');
  const [runtimePort, setRuntimePort] = useState('3000');
  const [healthCheckPath, setHealthCheckPath] = useState('/');
  const [preferredStrategy, setPreferredStrategy] = useState<'' | DeploymentStrategyId>('');
  const [enableHttps, setEnableHttps] = useState(false);
  const [installMissingDependencies, setInstallMissingDependencies] = useState(true);
  const [envText, setEnvText] = useState('');
  const [draft, setDraft] = useState<DeployDraft | null>(null);
  const [run, setRun] = useState<DeployRun | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncFromProfile = (profile: DeployDraft['profile'] | DeployRun['profile']) => {
    if (!profile) return;
    setProjectRoot(profile.projectRoot);
    setAppName(profile.appName);
    setDomain(profile.domain || '');
    setRuntimePort(String(profile.runtimePort || '3000'));
    setHealthCheckPath(profile.healthCheckPath || '/');
    setPreferredStrategy((profile.preferredStrategy || '') as '' | DeploymentStrategyId);
    setEnableHttps(profile.enableHttps);
    setInstallMissingDependencies(profile.installMissingDependencies);
    setEnvText(envVarsToText(profile.envVars));
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const runs = await window.electron.deployListRuns(profileId);
        if (!mounted || !runs.length) return;
        const latest = runs[0];
        setRun(latest);
        syncFromProfile(latest.profile);
      } catch {
        // ignore
      }
    })();

    const cleanUpdate = window.electron.onDeployRunUpdate(({ sessionId, run: nextRun }) => {
      if (sessionId !== connectionId) return;
      setRun(nextRun);
      if (nextRun.profile) {
        setDraft((current) =>
          current
            ? {
                ...current,
                profile: nextRun.profile!,
                strategyId: nextRun.outputs.strategyId || current.strategyId,
              }
            : current,
        );
      }
      if (nextRun.status !== 'running') {
        setIsStarting(false);
      }
    });
    const cleanFinished = window.electron.onDeployRunFinished(({ sessionId, run: finished }) => {
      if (sessionId !== connectionId) return;
      setRun(finished);
      setIsStarting(false);
    });

    return () => {
      mounted = false;
      cleanUpdate();
      cleanFinished();
    };
  }, [connectionId, profileId]);

  const buildPayload = () => {
    const parsedEnv = parseEnvText(envText);
    return {
      sessionId: connectionId,
      serverProfileId: profileId,
      projectRoot,
      appName: appName || undefined,
      domain: domain || undefined,
      preferredStrategy: preferredStrategy || undefined,
      runtimePort: Number(runtimePort) || undefined,
      envVars: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
      installMissingDependencies,
      enableHttps,
      healthCheckPath: healthCheckPath || '/',
    };
  };

  const browseProject = async () => {
    const selected = await window.electron.openDirectoryDialog({
      title: t('deploy.fields.projectDir'),
    });
    if (selected) {
      setProjectRoot(selected);
      if (!appName) {
        const parts = selected.split(/[\\/]/);
        setAppName(parts[parts.length - 1] || '');
      }
    }
  };

  const analyze = async () => {
    if (!projectRoot) {
      setError(t('deploy.messages.projectRequired'));
      return;
    }
    setError(null);
    setIsDrafting(true);
    try {
      const nextDraft = await window.electron.deployCreateDraft(buildPayload());
      setDraft(nextDraft);
      syncFromProfile(nextDraft.profile);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsDrafting(false);
    }
  };

  const startDeploy = async () => {
    if (!projectRoot) {
      setError(t('deploy.messages.projectRequired'));
      return;
    }
    setError(null);
    setIsStarting(true);
    try {
      await window.electron.deployStart(buildPayload());
    } catch (err: any) {
      setError(err?.message || String(err));
      setIsStarting(false);
    }
  };

  const cancelDeploy = () => {
    window.electron.deployCancel(connectionId);
  };

  return (
    <div className="h-full flex flex-col bg-card/40">
      <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
            <Rocket className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('deploy.title')}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {connectionName || host} • {formatRunStatus(t, run)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">{t('deploy.sections.project')}</div>
          <div className="flex gap-2">
            <Input
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder={t('deploy.placeholders.projectDir')}
              className="h-8 text-xs"
            />
            <Button variant="outline" size="sm" onClick={browseProject} className="gap-1.5 shrink-0">
              <FolderOpen className="w-3.5 h-3.5" />
              {t('deploy.actions.browse')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder={t('deploy.placeholders.appName')}
              className="h-8 text-xs"
            />
            <Input
              value={runtimePort}
              onChange={(e) => setRuntimePort(e.target.value)}
              placeholder={t('deploy.placeholders.runtimePort')}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('deploy.placeholders.domain')}
              className="h-8 text-xs"
            />
            <Input
              value={healthCheckPath}
              onChange={(e) => setHealthCheckPath(e.target.value)}
              placeholder={t('deploy.placeholders.healthPath')}
              className="h-8 text-xs"
            />
          </div>
          <select
            value={preferredStrategy}
            onChange={(e) => setPreferredStrategy(e.target.value as '' | DeploymentStrategyId)}
            className="w-full h-8 rounded-md border border-input bg-background/50 px-3 text-xs"
          >
            {strategyOptions.map((option) => (
              <option key={option.id || 'auto'} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={t('deploy.placeholders.envVars')}
            className="w-full min-h-[88px] rounded-md border border-input bg-background/50 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={installMissingDependencies}
                onChange={(e) => setInstallMissingDependencies(e.target.checked)}
              />
              {t('deploy.toggles.installDependencies')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableHttps}
                onChange={(e) => setEnableHttps(e.target.checked)}
              />
              {t('deploy.toggles.enableHttps')}
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={analyze}
              disabled={!isConnected || isDrafting || !projectRoot}
              className="gap-1.5"
            >
              {isDrafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
              {t('deploy.actions.analyze')}
            </Button>
            {run?.status === 'running' ? (
              <Button variant="destructive" size="sm" onClick={cancelDeploy} className="gap-1.5">
                <Square className="w-3.5 h-3.5" />
                {t('deploy.actions.cancel')}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={startDeploy}
                disabled={!isConnected || isStarting || !projectRoot}
                className="gap-1.5"
              >
                {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {t('deploy.actions.deploy')}
              </Button>
            )}
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 whitespace-pre-wrap break-all">
              {error}
            </div>
          )}
        </div>

        {draft && (
          <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">{t('deploy.sections.draft')}</div>
              <div className="text-[11px] px-2 py-1 rounded-full bg-primary/10 text-primary">
                {translateStrategy(t, draft.strategyId)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border/40 p-2">
                <div className="text-muted-foreground mb-1">{t('deploy.draft.project')}</div>
                <div className="font-medium">{draft.projectSpec.framework}</div>
                <div className="text-muted-foreground/80 mt-1 break-all">{draft.projectSpec.rootPath}</div>
              </div>
              <div className="rounded-lg border border-border/40 p-2">
                <div className="text-muted-foreground mb-1">{t('deploy.draft.server')}</div>
                <div className="font-medium">{draft.serverSpec.os}</div>
                <div className="text-muted-foreground/80 mt-1">
                  {t('deploy.draft.docker')} {draft.serverSpec.hasDocker ? t('deploy.bool.yes') : t('deploy.bool.no')} •{' '}
                  {t('deploy.draft.nginx')} {draft.serverSpec.hasNginx ? t('deploy.bool.yes') : t('deploy.bool.no')}
                </div>
              </div>
            </div>
            {draft.projectSpec.evidence.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {t('deploy.draft.evidence')}: {draft.projectSpec.evidence.join(' • ')}
              </div>
            )}
            {draft.warnings.length > 0 && (
              <div className="space-y-1">
                {draft.warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-2 text-[11px] text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
            {draft.missingInfo.length > 0 && (
              <div className="space-y-1">
                {draft.missingInfo.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-[11px] text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">{t('deploy.sections.run')}</div>
            {run?.outputs.url && (
              <a
                href={run.outputs.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Globe className="w-3 h-3" />
                {t('deploy.actions.open')}
              </a>
            )}
          </div>
          {run ? (
            <>
              <div className="flex items-center gap-2 text-[11px]">
                {run.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : run.status === 'failed' ? (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
                <span className="font-medium">{formatRunStatus(t, run)}</span>
                {run.outputs.url && <span className="text-muted-foreground truncate">{run.outputs.url}</span>}
              </div>
              <div className="space-y-1">
                {(run.steps || []).map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-2 rounded-lg border border-border/40 px-2.5 py-2 text-[11px]"
                  >
                    <div className="mt-0.5">
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                      ) : step.status === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-border/60" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium">{translateStepLabel(t, step)}</div>
                      <div className="text-muted-foreground break-all">{step.error || step.result || step.kind}</div>
                    </div>
                  </div>
                ))}
              </div>
              {(run.logs || []).length > 0 && (
                <div className="rounded-lg bg-black/30 border border-border/40 p-2 font-mono text-[10px] text-muted-foreground space-y-1 max-h-56 overflow-y-auto">
                  {(run.logs || []).slice(-40).map((entry) => (
                    <div key={entry.id} className="break-all">
                      <span className="text-foreground/70">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>{' '}
                      {entry.message}
                    </div>
                  ))}
                </div>
              )}
              {run.error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 whitespace-pre-wrap break-all">
                  {run.error}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">{t('deploy.messages.noRun')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
