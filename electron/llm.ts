// Main-process LLM HTTP client
// Supports OpenAI-compatible APIs and Anthropic natively (no renderer IPC needed)
// Uses Electron's net.fetch for reliable network access from the main process

import { net } from 'electron';

const DEFAULT_LLM_TIMEOUT_MS = 90_000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000;

interface LLMRequestController {
    signal?: AbortSignal;
    didTimeout: () => boolean;
    cleanup: () => void;
}

export interface LLMProfile {
    provider: string;   // 'deepseek' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama' | 'qwen' | 'custom'
    apiKey: string;
    baseUrl: string;
    model: string;
}

export type LLMMessage = {
    role: string;
    content: string | null;
    tool_calls?: LLMToolCall[];
    tool_call_id?: string;
};

export interface LLMToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

export interface LLMToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface LLMToolResponse {
    content: string | null;
    reasoningContent?: string | null;
    toolCalls: LLMToolCall[] | null;
    finishReason: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    modelUsed?: string;
}

export class LLMRequestError extends Error {
    status: number;
    code?: string;
    type?: string;
    requestId?: string;
    retryable: boolean;

    constructor(
        message: string,
        options: {
            status: number;
            code?: string;
            type?: string;
            requestId?: string;
            retryable?: boolean;
        },
    ) {
        super(message);
        this.name = 'LLMRequestError';
        this.status = options.status;
        this.code = options.code;
        this.type = options.type;
        this.requestId = options.requestId;
        this.retryable = Boolean(options.retryable);
    }
}

function createRequestController(signal?: AbortSignal, timeoutMs?: number): LLMRequestController {
    if (!signal && (!timeoutMs || timeoutMs <= 0)) {
        return {
            signal: undefined,
            didTimeout: () => false,
            cleanup: () => undefined,
        };
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const abortFromParent = () => {
        controller.abort(signal?.reason);
    };

    if (signal) {
        if (signal.aborted) {
            abortFromParent();
        } else {
            signal.addEventListener('abort', abortFromParent, { once: true });
        }
    }

    if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    }

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        cleanup: () => {
            if (timer) {
                clearTimeout(timer);
            }
            signal?.removeEventListener('abort', abortFromParent);
        },
    };
}

function throwTimeoutError(
    error: unknown,
    timeoutMs: number,
    didTimeout: boolean,
    fallbackPrefix: string,
): never {
    if (didTimeout) {
        const seconds = Math.max(1, Math.round(timeoutMs / 1000));
        throw new LLMRequestError(`${fallbackPrefix}: request timed out after ${seconds}s`, {
            status: 408,
            type: 'timeout',
            retryable: true,
        });
    }
    throw error;
}

function parseLLMError(rawText: string, status: number, fallbackPrefix: string): LLMRequestError {
    const retryableProviderMessage = /not available in your region|model is not available|no endpoints found|temporarily unavailable|rate limit/i.test(rawText);
    try {
        const parsed = JSON.parse(rawText);
        const code = parsed?.error?.code;
        const type = parsed?.error?.type;
        const message = parsed?.error?.message;
        const requestId = parsed?.error?.request_id || parsed?.request_id;
        const retryableMessage = /not available in your region|model is not available|no endpoints found|temporarily unavailable|rate limit/i.test(message || '');

        if (status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
            const detail = message || 'AI service is temporarily overloaded.';
            const suffix = requestId ? ` Request ID: ${requestId}` : '';
            return new LLMRequestError(
                `AI 服务当前繁忙，我会保留当前上下文。请稍后重试，或直接发送“继续”让我接着当前任务恢复。${detail}${suffix}`.trim(),
                {
                    status,
                    code,
                    type,
                    requestId,
                    retryable: true,
                },
            );
        }

        if (message) {
            return new LLMRequestError(`${fallbackPrefix}: ${message}`, {
                status,
                code,
                type,
                requestId,
                retryable: retryableMessage || retryableProviderMessage || status >= 500,
            });
        }
    } catch {
        // Ignore JSON parse errors and fall back to raw text.
    }

    if (status === 429) {
        return new LLMRequestError(
            'AI 服务当前繁忙，我会保留当前上下文。请稍后重试，或直接发送“继续”让我接着当前任务恢复。',
            {
                status,
                retryable: true,
            },
        );
    }

    return new LLMRequestError(`${fallbackPrefix}: ${rawText.slice(0, 300)}`, {
        status,
        retryable: retryableProviderMessage || status >= 500,
    });
}

export async function callLLM(
    profile: LLMProfile,
    messages: LLMMessage[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
    if (!profile || !profile.baseUrl || !profile.model) {
        throw new Error(`无效的 AI 配置：缺少 baseUrl 或 model（provider=${profile?.provider}）`);
    }

    const { provider, apiKey, baseUrl, model } = profile;
    const temperature = opts?.temperature ?? 0;
    const maxTokens  = opts?.maxTokens  ?? 4096;
    const signal     = opts?.signal;
    const timeoutMs  = opts?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

    if (provider === 'anthropic') {
        // Anthropic Messages API
        const systemMsg = messages.find(m => m.role === 'system');
        const turns = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content ?? '',
        }));

        const body: Record<string, any> = {
            model,
            messages: turns,
            max_tokens: maxTokens,
        };
        if (systemMsg?.content) body.system = systemMsg.content;

        const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
        const request = createRequestController(signal, timeoutMs);
        try {
            const res = await net.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify(body),
                signal: request.signal,
            });
            const text = await res.text();
            if (!res.ok) throw parseLLMError(text, res.status, 'Anthropic API request failed');
            const data = JSON.parse(text);
            const block = data?.content?.[0];
            if (block?.type === 'text') return block.text as string;
            throw new Error(`Unexpected Anthropic response: ${text.slice(0, 200)}`);
        } catch (error) {
            throwTimeoutError(error, timeoutMs, request.didTimeout(), 'Anthropic API request failed');
        } finally {
            request.cleanup();
        }
    }

    // OpenAI-compatible (deepseek, openai, groq, openrouter, ollama, qwen, custom)
    // Mirror the same endpoint logic as aiService.getEndpoint():
    //   - already has /chat/completions → use as-is
    //   - ends with /vN (e.g. Volcengine /api/v3) → append /chat/completions
    //   - otherwise → append /v1/chat/completions
    const cleanBase = baseUrl.replace(/\/+$/, '');
    let url: string;
    if (cleanBase.endsWith('/chat/completions')) {
        url = cleanBase;
    } else if (/\/v\d+$/.test(cleanBase)) {
        url = `${cleanBase}/chat/completions`;
    } else if (provider === 'ollama') {
        url = cleanBase.endsWith('/api/chat') ? cleanBase : `${cleanBase}/api/chat`;
    } else {
        url = `${cleanBase}/v1/chat/completions`;
    }
    const body = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
    };

    const request = createRequestController(signal, timeoutMs);
    try {
        const res = await net.fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: request.signal,
        });
        const text = await res.text();
        if (!res.ok) throw parseLLMError(text, res.status, 'LLM API request failed');
        const data = JSON.parse(text);
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string') return content;
        throw new Error(`Unexpected LLM response: ${text.slice(0, 200)}`);
    } catch (error) {
        throwTimeoutError(error, timeoutMs, request.didTimeout(), 'LLM API request failed');
    } finally {
        request.cleanup();
    }
}

export async function callLLMWithTools(
    profile: LLMProfile,
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number },
): Promise<LLMToolResponse> {
    if (!profile || !profile.baseUrl || !profile.model) {
        throw new Error(`Invalid AI config: missing baseUrl or model (provider=${profile?.provider})`);
    }

    const { provider, apiKey, baseUrl, model } = profile;
    const temperature = opts?.temperature ?? 0.2;
    const maxTokens = opts?.maxTokens ?? 2048;
    const signal = opts?.signal;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;

    if (provider === 'anthropic') {
        throw new Error('Anthropic tool calling is not implemented in the main-process runtime yet');
    }

    const cleanBase = baseUrl.replace(/\/+$/, '');
    let url: string;
    if (cleanBase.endsWith('/chat/completions')) {
        url = cleanBase;
    } else if (/\/v\d+$/.test(cleanBase)) {
        url = `${cleanBase}/chat/completions`;
    } else if (provider === 'ollama') {
        url = cleanBase.endsWith('/api/chat') ? cleanBase : `${cleanBase}/api/chat`;
    } else {
        url = `${cleanBase}/v1/chat/completions`;
    }

    const body: Record<string, any> = provider === 'ollama'
        ? {
            model,
            messages,
            stream: false,
            tools,
        }
        : {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
            tools,
        };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://reflex.app';
        headers['X-Title'] = 'Reflex';
    }

    const request = createRequestController(signal, timeoutMs);
    try {
        const res = await net.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: request.signal,
        });
        const text = await res.text();

        if (!res.ok) {
            try {
                const errorJson = JSON.parse(text);
                const failedGeneration = errorJson?.error?.failed_generation;
                if (errorJson?.error?.code === 'tool_use_failed' && failedGeneration) {
                    const funcMatch = failedGeneration.match(/<function=(\w+)>([\s\S]*)/);
                    if (funcMatch) {
                        return {
                            content: null,
                            toolCalls: [{
                                id: `call_${Date.now()}`,
                                type: 'function',
                                function: {
                                    name: funcMatch[1],
                                    arguments: funcMatch[2].trim(),
                                },
                            }],
                            finishReason: 'tool_calls',
                            modelUsed: model,
                        };
                    }
                }
            } catch {
                // fall through to standard error
            }
            throw parseLLMError(text, res.status, 'LLM API request failed');
        }

        const data = JSON.parse(text);
        const choice = data?.choices?.[0];
        const message = choice?.message;
        const usage = data?.usage ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
        } : undefined;

        if (message?.tool_calls?.length) {
            return {
                content: message.content || null,
                reasoningContent: message.reasoning_content || null,
                toolCalls: message.tool_calls,
                finishReason: choice?.finish_reason || 'tool_calls',
                usage,
                modelUsed: model,
            };
        }

        const content = message?.content || '';
        const funcMatch = content.match(/<function=(\w+)>([\s\S]*?)(?:<\/function>|$)/);
        if (funcMatch) {
            const visibleContent = content.slice(0, funcMatch.index).trim();
            return {
                content: visibleContent || null,
                toolCalls: [{
                    id: `call_${Date.now()}`,
                    type: 'function',
                    function: {
                        name: funcMatch[1],
                        arguments: funcMatch[2].trim(),
                    },
                }],
                finishReason: 'tool_calls',
                usage,
                modelUsed: model,
            };
        }

        return {
            content: content || null,
            reasoningContent: message?.reasoning_content || null,
            toolCalls: null,
            finishReason: choice?.finish_reason || 'stop',
            usage,
            modelUsed: model,
        };
    } catch (error) {
        throwTimeoutError(error, timeoutMs, request.didTimeout(), 'LLM API request failed');
    } finally {
        request.cleanup();
    }
}

