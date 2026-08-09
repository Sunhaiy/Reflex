import { safeStorage } from 'electron';
import { logger } from '../logger';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { OpenAIResponsesProvider } from './providers/openaiResponses';
import type { Provider, ProviderConfig } from './providers/types';
import {
  isChatModel,
  PROVIDER_PRESETS,
  type AgentConfig,
  type AgentConfigView,
  type ProviderKind,
  type ProviderWireApi,
} from '../../src/shared/agent';

/**
 * Deliberately absent from STORE_KEYS.
 *
 * That list is the renderer's permission check, so leaving this off it means `store-get`
 * refuses to hand the record over — and the record holds an API key. The renderer reads
 * the settings through a dedicated channel below that returns everything *except* the
 * key, and there is no channel that returns the key at all.
 */
const CONFIG_KEY = 'agentConfig';
const CIPHER_PREFIX = 'enc:v1:';

interface StoredProviderProfile {
  kind: ProviderKind;
  wireApi: ProviderWireApi;
  baseUrl: string;
  model: string;
  models: string[];
  apiKey?: string;
}

interface StoredConfig extends AgentConfig {
  apiKey?: string;
  profiles?: Record<string, StoredProviderProfile>;
}

const DEFAULT_CONFIG: AgentConfig = {
  providerId: 'anthropic',
  kind: 'anthropic',
  wireApi: 'messages',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-5',
  mode: 'free',
  effort: 'auto',
  contextBudget: 60_000,
  models: [],
};

/** Minimal surface so this module does not depend on how the store is constructed. */
export interface ConfigStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

function encrypt(value: string): string {
  if (!value || value.startsWith(CIPHER_PREFIX)) return value;
  if (!safeStorage.isEncryptionAvailable()) {
    logger.error('[Agent] OS keystore unavailable; the API key will be stored as entered');
    return value;
  }
  return CIPHER_PREFIX + safeStorage.encryptString(value).toString('base64');
}

function decrypt(value: string | undefined): string {
  if (!value) return '';
  if (!value.startsWith(CIPHER_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(CIPHER_PREFIX.length), 'base64'));
  } catch {
    // A keystore that cannot read its own output means a different OS user or a restored
    // profile. Better an empty key the user retypes than a crash on every request.
    logger.error('[Agent] Stored API key could not be decrypted');
    return '';
  }
}

function read(store: ConfigStore): StoredConfig {
  const stored = store.get(CONFIG_KEY);
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_CONFIG };
  const legacy = stored as StoredConfig;
  // Configs saved before wireApi existed used Messages for Anthropic and Chat
  // Completions for every OpenAI-compatible endpoint.
  const wireApi = legacy.wireApi
    ?? (legacy.kind === 'openai' ? 'chat_completions' : 'messages');
  const migrated = { ...DEFAULT_CONFIG, ...legacy, wireApi };
  return {
    ...migrated,
    providerId: legacy.providerId || inferProviderId(migrated),
  };
}

function inferProviderId(config: Pick<AgentConfig, 'kind' | 'wireApi' | 'baseUrl'>): string {
  const exact = PROVIDER_PRESETS.find(
    (preset) => preset.kind === config.kind && preset.baseUrl === config.baseUrl,
  );
  if (exact) return exact.id;
  if (config.kind === 'openai' && config.wireApi === 'responses') return 'sub2api';
  return 'custom';
}

function activeProfile(config: StoredConfig): StoredProviderProfile {
  return {
    kind: config.kind,
    wireApi: config.wireApi,
    baseUrl: config.baseUrl,
    model: config.model,
    models: config.models ?? [],
    apiKey: config.apiKey,
  };
}

function defaultProfile(providerId: string): StoredProviderProfile {
  const preset = PROVIDER_PRESETS.find((item) => item.id === providerId);
  if (preset) {
    return {
      kind: preset.kind,
      wireApi: preset.wireApi,
      baseUrl: preset.baseUrl,
      model: preset.model,
      models: [],
      apiKey: '',
    };
  }
  return {
    kind: 'openai',
    wireApi: 'chat_completions',
    baseUrl: '',
    model: '',
    models: [],
    apiKey: '',
  };
}

export function getConfigView(store: ConfigStore): AgentConfigView {
  const config = read(store);
  const key = decrypt(config.apiKey);
  return {
    providerId: config.providerId,
    kind: config.kind,
    wireApi: config.wireApi,
    baseUrl: config.baseUrl,
    model: config.model,
    mode: config.mode,
    effort: config.effort ?? 'auto',
    contextBudget: config.contextBudget || 60_000,
    models: config.models ?? [],
    hasKey: key.length > 0,
    keyHint: key ? key.slice(-4) : '',
  };
}

/** An absent `apiKey` keeps whatever is stored, so saving other settings never clears it. */
export function saveConfig(store: ConfigStore, patch: Partial<AgentConfig> & { apiKey?: string }) {
  const current = read(store);
  const next: StoredConfig = {
    providerId: patch.providerId ?? current.providerId,
    kind: patch.kind ?? current.kind,
    wireApi: patch.wireApi ?? current.wireApi,
    baseUrl: (patch.baseUrl ?? current.baseUrl).trim(),
    model: (patch.model ?? current.model).trim(),
    mode: patch.mode ?? current.mode,
    effort: patch.effort ?? current.effort ?? 'auto',
    contextBudget: Math.max(8_000, patch.contextBudget ?? current.contextBudget ?? 60_000),
    models: patch.models ?? current.models ?? [],
    apiKey: patch.apiKey === undefined ? current.apiKey : encrypt(patch.apiKey.trim()),
    profiles: current.profiles,
  };
  next.profiles = {
    ...current.profiles,
    [next.providerId]: activeProfile(next),
  };
  store.set(CONFIG_KEY, next);
}

/** Saves the current profile and restores the last values used for the selected one. */
export function selectProvider(store: ConfigStore, providerId: string): AgentConfigView {
  const current = read(store);
  const known = providerId === 'custom' || PROVIDER_PRESETS.some((item) => item.id === providerId);
  if (!known) return getConfigView(store);

  const profiles = {
    ...current.profiles,
    [current.providerId]: activeProfile(current),
  };
  const selected = profiles[providerId] ?? defaultProfile(providerId);
  const next: StoredConfig = {
    ...current,
    providerId,
    kind: selected.kind,
    wireApi: selected.wireApi,
    baseUrl: selected.baseUrl,
    model: selected.model,
    models: selected.models,
    apiKey: selected.apiKey,
    profiles,
  };
  store.set(CONFIG_KEY, next);
  return getConfigView(store);
}

/** Builds the provider for a run. Throws with something actionable when unconfigured. */
export function createProvider(store: ConfigStore): Provider {
  const config = read(store);
  const apiKey = decrypt(config.apiKey);

  if (!apiKey) throw new Error('No API key is set. Add one in Settings before using the agent.');
  if (!config.model) throw new Error('No model is set. Choose one in Settings.');

  const resolved: ProviderConfig = {
    kind: config.kind,
    wireApi: config.wireApi,
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    effort: config.effort ?? 'auto',
  };
  if (config.kind === 'anthropic') return new AnthropicProvider(resolved);
  return config.wireApi === 'responses'
    ? new OpenAIResponsesProvider(resolved)
    : new OpenAIProvider(resolved);
}

/**
 * Every model the configured endpoint serves.
 *
 * A self-hosted gateway's whitelist is the only place its model names exist — there is
 * nothing to hardcode them from, and typing one by hand is how you end up pointed at an
 * image model.
 */
export async function listModels(
  store: ConfigStore,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  try {
    // Filtered here rather than in the settings page, so the panel's switcher and the
    // count shown after a sync are reading the same list.
    const models = (await createProvider(store).listModels()).filter(isChatModel);
    saveConfig(store, { models });
    return { ok: true, models };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One cheap round trip to prove the key, base URL and model all work together. Worth its
 * own button: the alternative is finding out four turns into a deployment.
 */
export async function testConnection(store: ConfigStore): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const provider = createProvider(store);
    await provider.complete(
      {
        system: 'Reply with the single word OK.',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'ping' }] }],
        tools: [],
      },
      { onText: () => undefined, onToolCall: () => undefined },
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
