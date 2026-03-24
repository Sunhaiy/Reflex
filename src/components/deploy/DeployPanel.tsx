import { useEffect, useState } from 'react';
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
  DeploymentStrategyId,
} from '../../shared/deployTypes';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface DeployPanelProps {
  connectionId: string;
  profileId: string;
  host: string;
  connectionName?: string;
  isConnected: boolean;
}

const STRATEGY_OPTIONS: { id: '' | DeploymentStrategyId; label: string }[] = [
  { id: '', label: 'Auto' },
  { id: 'static-nginx', label: 'Static + Nginx' },
  { id: 'node-systemd', label: 'Node + systemd' },
  { id: 'next-standalone', label: 'Next.js' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'docker-compose', label: 'Docker Compose' },
  { id: 'python-systemd', label: 'Python + systemd' },
];

function parseEnvText(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return acc;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1);
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function formatStatus(run?: DeployRun | null) {
  if (!run) return 'Idle';
  return `${run.status} / ${run.phase}`;
}

export function DeployPanel({
  connectionId,
  profileId,
  host,
  connectionName,
  isConnected,
}: DeployPanelProps) {
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const runs = await window.electron.deployListRuns(profileId);
        if (!mounted || !runs.length) return;
        const latest = runs[0];
        setRun(latest);
        if (latest.profile) {
          setProjectRoot(latest.profile.projectRoot);
          setAppName(latest.profile.appName);
          setDomain(latest.profile.domain || '');
          setRuntimePort(String(latest.profile.runtimePort || '3000'));
          setHealthCheckPath(latest.profile.healthCheckPath || '/');
          setPreferredStrategy((latest.profile.preferredStrategy || '') as '' | DeploymentStrategyId);
          setEnableHttps(latest.profile.enableHttps);
          setInstallMissingDependencies(latest.profile.installMissingDependencies);
          setEnvText(
            Object.entries(latest.profile.envVars || {})
              .map(([key, value]) => `${key}=${value}`)
              .join('\n'),
          );
        }
      } catch {
        // ignore
      }
    })();

    const cleanUpdate = window.electron.onDeployRunUpdate(({ sessionId, run: nextRun }) => {
      if (sessionId !== connectionId) return;
      setRun(nextRun);
      if (nextRun.profile) {
        setDraft((current) =>
          current ? { ...current, profile: nextRun.profile!, strategyId: nextRun.outputs.strategyId || current.strategyId } : current,
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

  const buildPayload = () => ({
    sessionId: connectionId,
    serverProfileId: profileId,
    projectRoot,
    appName: appName || undefined,
    domain: domain || undefined,
    preferredStrategy: preferredStrategy || undefined,
    runtimePort: Number(runtimePort) || undefined,
    envVars: parseEnvText(envText),
    installMissingDependencies,
    enableHttps,
    healthCheckPath: healthCheckPath || '/',
  });

  const browseProject = async () => {
    const selected = await window.electron.openDirectoryDialog({
      title: 'Select local project directory',
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
      setError('Project directory is required');
      return;
    }
    setError(null);
    setIsDrafting(true);
    try {
      const nextDraft = await window.electron.deployCreateDraft(buildPayload());
      setDraft(nextDraft);
      setAppName(nextDraft.profile.appName);
      setRuntimePort(String(nextDraft.profile.runtimePort || '3000'));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsDrafting(false);
    }
  };

  const startDeploy = async () => {
    if (!projectRoot) {
      setError('Project directory is required');
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
            <div className="text-sm font-semibold">Deploy</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {connectionName || host} · {formatStatus(run)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Project</div>
          <div className="flex gap-2">
            <Input
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder="Local project directory"
              className="h-8 text-xs"
            />
            <Button variant="outline" size="sm" onClick={browseProject} className="gap-1.5 shrink-0">
              <FolderOpen className="w-3.5 h-3.5" />
              Browse
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="App name"
              className="h-8 text-xs"
            />
            <Input
              value={runtimePort}
              onChange={(e) => setRuntimePort(e.target.value)}
              placeholder="Runtime port"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (optional)"
              className="h-8 text-xs"
            />
            <Input
              value={healthCheckPath}
              onChange={(e) => setHealthCheckPath(e.target.value)}
              placeholder="Health path"
              className="h-8 text-xs"
            />
          </div>
          <select
            value={preferredStrategy}
            onChange={(e) => setPreferredStrategy(e.target.value as '' | DeploymentStrategyId)}
            className="w-full h-8 rounded-md border border-input bg-background/50 px-3 text-xs"
          >
            {STRATEGY_OPTIONS.map((option) => (
              <option key={option.id || 'auto'} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={'ENV_VAR=value\nAPI_URL=https://api.example.com'}
            className="w-full min-h-[88px] rounded-md border border-input bg-background/50 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={installMissingDependencies}
                onChange={(e) => setInstallMissingDependencies(e.target.checked)}
              />
              Install missing dependencies
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableHttps}
                onChange={(e) => setEnableHttps(e.target.checked)}
              />
              Enable HTTPS
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
              Analyze
            </Button>
            {run?.status === 'running' ? (
              <Button variant="destructive" size="sm" onClick={cancelDeploy} className="gap-1.5">
                <Square className="w-3.5 h-3.5" />
                Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={startDeploy}
                disabled={!isConnected || isStarting || !projectRoot}
                className="gap-1.5"
              >
                {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Deploy
              </Button>
            )}
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
              {error}
            </div>
          )}
        </div>

        {draft && (
          <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Draft</div>
              <div className="text-[11px] px-2 py-1 rounded-full bg-primary/10 text-primary">
                {draft.strategyId}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border/40 p-2">
                <div className="text-muted-foreground mb-1">Project</div>
                <div className="font-medium">{draft.projectSpec.framework}</div>
                <div className="text-muted-foreground/80 mt-1 break-all">{draft.projectSpec.rootPath}</div>
              </div>
              <div className="rounded-lg border border-border/40 p-2">
                <div className="text-muted-foreground mb-1">Server</div>
                <div className="font-medium">{draft.serverSpec.os}</div>
                <div className="text-muted-foreground/80 mt-1">
                  Docker {draft.serverSpec.hasDocker ? 'yes' : 'no'} · Nginx {draft.serverSpec.hasNginx ? 'yes' : 'no'}
                </div>
              </div>
            </div>
            {draft.projectSpec.evidence.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Evidence: {draft.projectSpec.evidence.join(' · ')}
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
            <div className="text-xs font-medium text-muted-foreground">Run</div>
            {run?.outputs.url && (
              <a
                href={run.outputs.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Globe className="w-3 h-3" />
                Open
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
                <span className="font-medium">{formatStatus(run)}</span>
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
                      <div className="font-medium">{step.label}</div>
                      <div className="text-muted-foreground break-all">
                        {step.error || step.result || step.kind}
                      </div>
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
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                  {run.error}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">No deployment run yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
