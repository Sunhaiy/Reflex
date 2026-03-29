// AI Service - Handles communication with AI providers (DeepSeek, OpenAI, etc.)

import { AIConfig, AICompletionRequest, AICompletionResponse, AI_PROVIDER_CONFIGS, ChatMessage, ToolDefinition, ToolCall, ToolCompletionResponse, AIProviderProfile } from '../shared/aiTypes';

class AIService {
    private config: AIConfig | null = null;

    private async formatHttpError(response: { status: number; text(): Promise<string> }, fallbackPrefix = 'AI request failed'): Promise<Error> {
        const rawText = await response.text();

        try {
            const parsed = JSON.parse(rawText);
            const code = parsed?.error?.code;
            const message = parsed?.error?.message;
            const type = parsed?.error?.type;
            const requestId = parsed?.error?.request_id || parsed?.request_id;

            if (response.status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
                const detail = message || 'The AI service is currently overloaded.';
                const suffix = requestId ? ` Request ID: ${requestId}` : '';
                return new Error(`AI 服务当前繁忙，请稍后重试或切换模型。${detail}${suffix}`);
            }

            if (message) {
                return new Error(`${fallbackPrefix}: ${message}`);
            }
        } catch {
            // Ignore JSON parse errors and fall back to raw text.
        }

        if (response.status === 429) {
            return new Error('AI 服务当前繁忙，请稍后重试或切换模型。');
        }

        return new Error(`${fallbackPrefix}: ${rawText}`);
    }

    setConfig(config: AIConfig) {
        this.config = config;
    }

    getConfig(): AIConfig | null {
        return this.config;
    }

    isConfigured(): boolean {
        if (!this.config) return false;
        // Ollama doesn't require API key
        if (this.config.provider === 'ollama') return true;
        return !!(this.config.apiKey && this.config.apiKey.length > 0);
    }

    // Build AIConfig from a saved profile
    setConfigFromProfile(profile: AIProviderProfile): void {
        const providerConfig = AI_PROVIDER_CONFIGS[profile.provider];
        this.config = {
            provider: profile.provider,
            apiKey: profile.apiKey,
            baseUrl: profile.baseUrl || providerConfig?.baseUrl || undefined,
            model: profile.model || providerConfig?.defaultModel || undefined,
            privacyMode: false, // global setting handled separately
        };
    }

    // Build a temporary AIConfig from a profile (does NOT change this.config)
    private configFromProfile(profile: AIProviderProfile): AIConfig {
        const providerConfig = AI_PROVIDER_CONFIGS[profile.provider];
        return {
            provider: profile.provider,
            apiKey: profile.apiKey,
            baseUrl: profile.baseUrl || providerConfig?.baseUrl || undefined,
            model: profile.model || providerConfig?.defaultModel || undefined,
            privacyMode: this.config?.privacyMode ?? false,
        };
    }

    // Privacy mode: sanitize sensitive information
    sanitize(text: string): string {
        if (!this.config?.privacyMode) return text;

        return text
            // IP addresses
            .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[IP_REDACTED]')
            // Passwords in various formats
            .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
            .replace(/passwd[=:]\s*\S+/gi, 'passwd=[REDACTED]')
            // API keys and tokens
            .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
            .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
            .replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]')
            // SSH keys (very long base64 strings)
            .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[SSH_KEY_REDACTED]')
            // Common env var patterns
            .replace(/export\s+\w+_KEY=\S+/gi, 'export [KEY_REDACTED]')
            .replace(/export\s+\w+_SECRET=\S+/gi, 'export [SECRET_REDACTED]');
    }

    // Build the final API endpoint URL
    private getEndpoint(baseUrl: string, isOllama: boolean): string {
        const cleanBase = baseUrl.replace(/\/+$/, '');

        if (isOllama) {
            if (cleanBase.endsWith('/api/chat')) return cleanBase;
            return `${cleanBase}/api/chat`;
        } else {
            if (cleanBase.endsWith('/chat/completions')) return cleanBase;
            // /v1 or /v3 (Volcengine CodePlan uses /v3) — append /chat/completions
            if (/\/v\d+$/.test(cleanBase)) return `${cleanBase}/chat/completions`;
            return `${cleanBase}/v1/chat/completions`;
        }
    }

    // Proxy fetch through Electron main process to avoid renderer CORS restrictions.
    // Falls back to native fetch in non-Electron environments (web/test).
    private async proxyFetch(url: string, options: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
        const el = (window as any).electron;
        if (el?.aiFetch) {
            const result = await el.aiFetch({ url, ...options });
            return {
                ok: result.ok,
                status: result.status,
                text: async () => result.body,
            };
        }
        // Fallback: direct fetch (works in non-Electron / dev server with CORS)
        return fetch(url, options);
    }

    // Non-streaming completion
    async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
        if (!this.config) {
            throw new Error('AI service not configured. Please set your API key in Settings.');
        }

        // For non-Ollama providers, require API key
        if (this.config.provider !== 'ollama' && !this.config.apiKey) {
            throw new Error('API key required. Please set your API key in Settings.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[this.config.provider];
        const baseUrl = this.config.baseUrl || providerConfig.baseUrl;
        const model = this.config.model || providerConfig.defaultModel;

        // Sanitize messages if privacy mode is on
        const sanitizedMessages = request.messages.map(msg => ({
            ...msg,
            content: this.sanitize(msg.content || '')
        }));

        // Choose endpoint and headers based on provider
        const isOllama = this.config.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        // OpenRouter requires HTTP-Referer
        if (this.config.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://sshtool.app';
            headers['X-Title'] = 'SSH Tool';
        }

        // Build request body - Ollama uses slightly different format
        const requestBody = isOllama ? {
            model,
            messages: sanitizedMessages,
            stream: false
        } : {
            model,
            messages: sanitizedMessages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 2048,
            stream: false
        };

        const response = await this.proxyFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw await this.formatHttpError(response);
        }

        const data = JSON.parse(await response.text());

        // Ollama response format is different
        if (isOllama) {
            return {
                content: data.message?.content || '',
                finishReason: 'stop'
            };
        }

        return {
            content: data.choices?.[0]?.message?.content || '',
            finishReason: data.choices?.[0]?.finish_reason
        };
    }

    // Streaming completion with callback
    async *streamComplete(request: AICompletionRequest): AsyncGenerator<string, void, unknown> {
        if (!this.config) {
            throw new Error('AI service not configured. Please set your API key in Settings.');
        }

        // For non-Ollama providers, require API key
        if (this.config.provider !== 'ollama' && !this.config.apiKey) {
            throw new Error('API key required. Please set your API key in Settings.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[this.config.provider];
        const baseUrl = this.config.baseUrl || providerConfig.baseUrl;
        const model = this.config.model || providerConfig.defaultModel;

        // Sanitize messages if privacy mode is on
        const sanitizedMessages = request.messages.map(msg => ({
            ...msg,
            content: this.sanitize(msg.content || '')
        }));

        const isOllama = this.config.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        if (this.config.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://sshtool.app';
            headers['X-Title'] = 'SSH Tool';
        }

        const requestBody = isOllama ? {
            model,
            messages: sanitizedMessages,
            stream: true
        } : {
            model,
            messages: sanitizedMessages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 2048,
            stream: true
        };

        const response = await this.proxyFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw await this.formatHttpError(response);
        }

        // For streaming, parse the full SSE body returned by proxyFetch
        const fullBody = await response.text();
        const lines = fullBody.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') return;
                try {
                    const parsed = JSON.parse(data);
                    const content = isOllama
                        ? parsed.message?.content
                        : parsed.choices?.[0]?.delta?.content;
                    if (content) yield content;
                } catch { }
            }
        }
    }

    // Non-streaming completion with Function Calling (tools)
    async completeWithTools(request: {
        messages: ChatMessage[];
        tools: ToolDefinition[];
        temperature?: number;
        overrideModel?: string;   // switch model per-request without changing config
        overrideProfile?: AIProviderProfile;  // use a completely different provider's API key/base
    }): Promise<ToolCompletionResponse> {
        // If an override profile is provided, use it instead of global config
        const effectiveConfig = request.overrideProfile
            ? this.configFromProfile(request.overrideProfile)
            : this.config;

        if (!effectiveConfig) {
            throw new Error('AI service not configured.');
        }
        if (effectiveConfig.provider !== 'ollama' && !effectiveConfig.apiKey) {
            throw new Error('API key required.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[effectiveConfig.provider];
        const baseUrl = effectiveConfig.baseUrl || providerConfig.baseUrl;
        // overrideModel > config model > provider default
        const model = request.overrideModel || effectiveConfig.model || providerConfig.defaultModel;
        const isOllama = effectiveConfig.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (effectiveConfig.apiKey) headers['Authorization'] = `Bearer ${effectiveConfig.apiKey}`;
        if (effectiveConfig.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://sshtool.app';
            headers['X-Title'] = 'SSH Tool';
        }

        const sanitizedMessages = request.messages.map(msg => ({
            ...msg,
            content: msg.content ? this.sanitize(msg.content) : msg.content,
        }));

        const requestBody: any = {
            model,
            messages: sanitizedMessages,
            temperature: request.temperature ?? 0.7,
            stream: false,
            tools: request.tools,
        };

        const response = await this.proxyFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();

            // Handle models that don't support native function calling
            // They output <function=name>{"arg":"val"} which the API rejects with tool_use_failed
            try {
                const errorJson = JSON.parse(errorText);
                const failedGen = errorJson?.error?.failed_generation;
                if (errorJson?.error?.code === 'tool_use_failed' && failedGen) {
                    // Parse: <function=execute_ssh_command>{"command": "uptime"}
                    const funcMatch = failedGen.match(/<function=(\w+)>([\s\S]*)/);
                    if (funcMatch) {
                        const funcName = funcMatch[1];
                        const argsStr = funcMatch[2].trim();
                        return {
                            content: null,
                            toolCalls: [{
                                id: `call_${Date.now()}`,
                                type: 'function' as const,
                                function: {
                                    name: funcName,
                                    arguments: argsStr,
                                }
                            }],
                            finishReason: 'tool_calls',
                        };
                    }
                }
            } catch { }

            try {
                const parsed = JSON.parse(errorText);
                const code = parsed?.error?.code;
                const type = parsed?.error?.type;
                const message = parsed?.error?.message;
                const requestId = parsed?.error?.request_id || parsed?.request_id;

                if (response.status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
                    const suffix = requestId ? ` Request ID: ${requestId}` : '';
                    throw new Error(`AI 服务当前繁忙，请稍后重试或切换模型。${message || ''}${suffix}`.trim());
                }

                if (message) {
                    throw new Error(`AI request failed: ${message}`);
                }
            } catch (parsedError) {
                if (parsedError instanceof Error && parsedError.message !== errorText) {
                    throw parsedError;
                }
            }

            if (response.status === 429) {
                throw new Error('AI 服务当前繁忙，请稍后重试或切换模型。');
            }

            throw new Error(`AI request failed: ${errorText}`);
        }

        const data = JSON.parse(await response.text());
        const choice = data.choices?.[0];
        const message = choice?.message;
        const usage = data.usage ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
        } : undefined;

        // If model returned tool_calls natively, use them
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

        // Fallback: parse <function=name>{"arg":"val"} from content text
        const content = message?.content || '';
        const funcMatch = content.match(/<function=(\w+)>([\s\S]*?)(?:<\/function>|$)/);
        if (funcMatch) {
            return {
                content: null,
                toolCalls: [{
                    id: `call_${Date.now()}`,
                    type: 'function' as const,
                    function: {
                        name: funcMatch[1],
                        arguments: funcMatch[2].trim(),
                    }
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
    }

    async textToCommand(naturalLanguage: string, context?: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.textToCommand },
            { role: 'user', content: context ? `当前目录: ${context}\n\n${naturalLanguage}` : naturalLanguage }
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content.trim();
    }

    // Helper: Error analysis
    async analyzeError(errorText: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.errorAnalysis },
            { role: 'user', content: errorText }
        ];

        const response = await this.complete({ messages, temperature: 0.5 });
        return response.content;
    }

    // Helper: Log summary
    async summarizeLogs(logText: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.logSummary },
            { role: 'user', content: logText }
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content;
    }

    // Helper: Explain command/output
    async explainCommand(text: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.explainCommand },
            { role: 'user', content: text }
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content;
    }
}

// Singleton instance
export const aiService = new AIService();
