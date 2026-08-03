/**
 * The contract between the agent running in the main process and the panel rendering it.
 *
 * Lives in shared so the renderer never has to import from electron/, which would drag
 * ssh2 and the provider SDKs into the browser bundle.
 */

export type ProviderKind = 'anthropic' | 'openai';

/**
 * How much the agent may do on its own.
 *
 * `readonly` runs an allowlist of commands that only read. `ask` pauses before anything
 * that changes state. `auto` runs freely — except a short list of commands that would
 * destroy data or cut the connection, which stop in every mode.
 */
export type AgentMode = 'readonly' | 'ask' | 'auto';

export interface AgentConfig {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  mode: AgentMode;
}

/** What the settings page may see. There is no channel that returns the key itself. */
export interface AgentConfigView extends AgentConfig {
  hasKey: boolean;
  /** Last four characters, so the user can tell which key is stored. */
  keyHint: string;
}

export type ApprovalAnswer = 'allow' | 'always' | 'deny';

export interface ApprovalQuestion {
  callId: string;
  tool: string;
  command?: string;
  input: Record<string, unknown>;
  reason: string;
  /** Empty when this kind cannot be remembered; the UI hides "always allow" then. */
  group: string;
}

export type AgentStopReason = 'done' | 'max_turns' | 'aborted';

/** Everything the renderer is told about a run, in the order it happens. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; callId: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_output'; callId: string; chunk: string }
  | { type: 'tool_end'; callId: string; output: string; isError: boolean }
  | { type: 'approval'; question: ApprovalQuestion }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: AgentStopReason; turns: number }
  | { type: 'error'; message: string };

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Empty when the endpoint has no sensible default — Ark names models per deployment. */
  model: string;
  /** Where to get a key. */
  console: string;
}

/**
 * Presets, not a closed list: base URL and model stay editable in the UI. These endpoints
 * move, and a stale hardcoded list must not be the thing that stops someone connecting.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    console: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.1',
    console: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-opus-4.5',
    console: 'https://openrouter.ai/keys',
  },
  {
    id: 'dashscope',
    label: '通义千问',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    console: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'ark',
    label: '火山引擎',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    console: 'https://console.volcengine.com/ark',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    console: 'https://platform.deepseek.com/api_keys',
  },
];
