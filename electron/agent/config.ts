import { safeStorage } from 'electron';
import { logger } from '../logger';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import type { Provider, ProviderConfig } from './providers/types';
import { isChatModel, type AgentConfig, type AgentConfigView } from '../../src/shared/agent';

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

interface StoredConfig extends AgentConfig {
  apiKey?: string;
}

const DEFAULT_CONFIG: AgentConfig = {
  kind: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-5',
  mode: 'ask',
  effort: 'auto',
  dock: 'bottom',
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
  return { ...DEFAULT_CONFIG, ...(stored as StoredConfig) };
}

export function getConfigView(store: ConfigStore): AgentConfigView {
  const config = read(store);
  const key = decrypt(config.apiKey);
  return {
    kind: config.kind,
    baseUrl: config.baseUrl,
    model: config.model,
    mode: config.mode,
    effort: config.effort ?? 'auto',
    dock: config.dock,
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
    kind: patch.kind ?? current.kind,
    baseUrl: (patch.baseUrl ?? current.baseUrl).trim(),
    model: (patch.model ?? current.model).trim(),
    mode: patch.mode ?? current.mode,
    effort: patch.effort ?? current.effort ?? 'auto',
    dock: patch.dock ?? current.dock,
    contextBudget: Math.max(8_000, patch.contextBudget ?? current.contextBudget ?? 60_000),
    models: patch.models ?? current.models ?? [],
    apiKey: patch.apiKey === undefined ? current.apiKey : encrypt(patch.apiKey.trim()),
  };
  store.set(CONFIG_KEY, next);
}

/** Builds the provider for a run. Throws with something actionable when unconfigured. */
export function createProvider(store: ConfigStore): Provider {
  const config = read(store);
  const apiKey = decrypt(config.apiKey);

  if (!apiKey) throw new Error('No API key is set. Add one in Settings before using the agent.');
  if (!config.model) throw new Error('No model is set. Choose one in Settings.');

  const resolved: ProviderConfig = {
    kind: config.kind,
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    effort: config.effort ?? 'auto',
  };
  return config.kind === 'anthropic'
    ? new AnthropicProvider(resolved)
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
