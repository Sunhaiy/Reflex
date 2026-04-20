import {
    AIConfig,
    AICompletionRequest,
    AICompletionResponse,
    AI_PROVIDER_CONFIGS,
    AIProviderProfile,
    ChatMessage,
    ToolCompletionResponse,
    ToolDefinition,
} from '../shared/aiTypes';

class AIService {
    private config: AIConfig | null = null;
    private readonly maxRequestAttempts = 3;

    setConfig(config: AIConfig) {
        this.config = config;
    }

    getConfig(): AIConfig | null {
        return this.config;
    }

    isConfigured(): boolean {
        if (!this.config) return false;
        if (this.config.provider === 'ollama') return true;
        return Boolean(this.config.apiKey && this.config.apiKey.length > 0);
    }

    setConfigFromProfile(profile: AIProviderProfile): void {
        const providerConfig = AI_PROVIDER_CONFIGS[profile.provider];
        this.config = {
            provider: profile.provider,
            apiKey: profile.apiKey,
            baseUrl: profile.baseUrl || providerConfig?.baseUrl || undefined,
            model: profile.model || providerConfig?.defaultModel || undefined,
            privacyMode: this.config?.privacyMode ?? false,
        };
    }

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

    sanitize(text: string): string {
        if (!this.config?.privacyMode) return text;

        return text
            .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[IP_REDACTED]')
            .replace(/authorization\s*:\s*bearer\s+[^\s"']+/gi, 'Authorization: Bearer [REDACTED]')
            .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g, 'Bearer [REDACTED]')
            .replace(/\b(password|passwd|pwd)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
            .replace(/\b(api[_-]?key|token|secret|client_secret|access_token|refresh_token)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
            .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[SSH_KEY_REDACTED]')
            .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^:@\s/]+)(?::([^@\s]+))?@/gi, (_match, protocol) => `${protocol}[REDACTED]@`)
            .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|DATABASE_URL))\b\s*=\s*("[^"]*"|'[^']*'|\S+)/g, '$1=[REDACTED]')
            .replace(/export\s+\w+_KEY\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, 'export [KEY_REDACTED]')
            .replace(/export\s+\w+_SECRET\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, 'export [SECRET_REDACTED]');
    }

    private getEndpoint(baseUrl: string, isOllama: boolean): string {
        const cleanBase = baseUrl.replace(/\/+$/, '');
        if (isOllama) {
            return cleanBase.endsWith('/api/chat') ? cleanBase : `${cleanBase}/api/chat`;
        }
        if (cleanBase.endsWith('/chat/completions')) return cleanBase;
        if (/\/v\d+$/.test(cleanBase)) return `${cleanBase}/chat/completions`;
        return `${cleanBase}/v1/chat/completions`;
    }

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
        return fetch(url, options);
    }

    private shouldRetryError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error || '');
        return /AI service is busy|temporarily|overloaded|timeout|network|fetch failed|failed to fetch|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|429|5\d{2}|not available in your region|model is not available|no endpoints found|rate limit/i.test(message);
    }

    private async waitBeforeRetry(attempt: number) {
        const delayMs = Math.min(4000, 700 * (2 ** (attempt - 1)));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    private withRetryContext(error: unknown, attempts: number): Error {
        const message = error instanceof Error ? error.message : String(error || 'AI request failed');
        if (attempts < this.maxRequestAttempts) return error instanceof Error ? error : new Error(message);
        if (/retried \d+\/\d+/i.test(message)) return error instanceof Error ? error : new Error(message);
        return new Error(`${message} Retried ${attempts}/${this.maxRequestAttempts} times.`);
    }

    private async fetchWithRetries(
        url: string,
        options: { method: string; headers: Record<string, string>; body: string },
        fallbackPrefix = 'AI request failed',
    ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
        for (let attempt = 1; attempt <= this.maxRequestAttempts; attempt += 1) {
            try {
                const response = await this.proxyFetch(url, options);
                if (response.ok) return response;

                const formattedError = await this.formatHttpError(response, fallbackPrefix);
                if (attempt < this.maxRequestAttempts && this.shouldRetryError(formattedError)) {
                    await this.waitBeforeRetry(attempt);
                    continue;
                }
                throw this.withRetryContext(formattedError, attempt);
            } catch (error) {
                if (attempt < this.maxRequestAttempts && this.shouldRetryError(error)) {
                    await this.waitBeforeRetry(attempt);
                    continue;
                }
                throw this.withRetryContext(error, attempt);
            }
        }

        throw new Error(`AI request failed. Retried ${this.maxRequestAttempts}/${this.maxRequestAttempts} times.`);
    }

    private async formatHttpError(response: { status: number; text(): Promise<string> }, fallbackPrefix = 'AI request failed'): Promise<Error> {
        const rawText = await response.text();

        try {
            const parsed = JSON.parse(rawText);
            const code = parsed?.error?.code;
            const message = parsed?.error?.message;
            const type = parsed?.error?.type;
            const requestId = parsed?.error?.request_id || parsed?.request_id;

            if (response.status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
                const detail = message || 'The AI service is temporarily overloaded.';
                const suffix = requestId ? ` Request ID: ${requestId}` : '';
                return new Error(`AI service is busy right now. Please retry in a moment or switch models. ${detail}${suffix}`.trim());
            }

            if (message) {
                return new Error(`${fallbackPrefix}: ${message}`);
            }
        } catch {
            // Fall through to raw text error handling.
        }

        if (response.status === 429) {
            return new Error('AI service is busy right now. Please retry in a moment or switch models.');
        }

        return new Error(`${fallbackPrefix}: ${rawText}`);
    }

    async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
        if (!this.config) {
            throw new Error('AI service not configured. Please set your API key in Settings.');
        }

        if (this.config.provider !== 'ollama' && !this.config.apiKey) {
            throw new Error('API key required. Please set your API key in Settings.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[this.config.provider];
        const baseUrl = this.config.baseUrl || providerConfig.baseUrl;
        const model = this.config.model || providerConfig.defaultModel;
        const isOllama = this.config.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const sanitizedMessages = request.messages.map((msg) => ({
            ...msg,
            content: this.sanitize(msg.content || ''),
        }));

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        if (this.config.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://reflex.app';
            headers['X-Title'] = 'Reflex';
        }

        const requestBody = isOllama
            ? {
                model,
                messages: sanitizedMessages,
                stream: false,
            }
            : {
                model,
                messages: sanitizedMessages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 2048,
                stream: false,
            };

        const response = await this.fetchWithRetries(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw await this.formatHttpError(response);
        }

        const data = JSON.parse(await response.text());

        if (isOllama) {
            return {
                content: data.message?.content || '',
                finishReason: 'stop',
            };
        }

        return {
            content: data.choices?.[0]?.message?.content || '',
            finishReason: data.choices?.[0]?.finish_reason,
        };
    }

    async *streamComplete(request: AICompletionRequest): AsyncGenerator<string, void, unknown> {
        if (!this.config) {
            throw new Error('AI service not configured. Please set your API key in Settings.');
        }

        if (this.config.provider !== 'ollama' && !this.config.apiKey) {
            throw new Error('API key required. Please set your API key in Settings.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[this.config.provider];
        const baseUrl = this.config.baseUrl || providerConfig.baseUrl;
        const model = this.config.model || providerConfig.defaultModel;
        const isOllama = this.config.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const sanitizedMessages = request.messages.map((msg) => ({
            ...msg,
            content: this.sanitize(msg.content || ''),
        }));

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        if (this.config.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://reflex.app';
            headers['X-Title'] = 'Reflex';
        }

        const requestBody = isOllama
            ? {
                model,
                messages: sanitizedMessages,
                stream: true,
            }
            : {
                model,
                messages: sanitizedMessages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 2048,
                stream: true,
            };

        const response = await this.fetchWithRetries(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw await this.formatHttpError(response);
        }

        const fullBody = await response.text();
        const lines = fullBody.split('\n');

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
                const parsed = JSON.parse(data);
                const content = isOllama
                    ? parsed.message?.content
                    : parsed.choices?.[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            } catch {
                // Ignore malformed SSE chunks.
            }
        }
    }

    async completeWithTools(request: {
        messages: ChatMessage[];
        tools: ToolDefinition[];
        temperature?: number;
        overrideModel?: string;
        overrideProfile?: AIProviderProfile;
    }): Promise<ToolCompletionResponse> {
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
        const model = request.overrideModel || effectiveConfig.model || providerConfig.defaultModel;
        const isOllama = effectiveConfig.provider === 'ollama';
        const endpoint = this.getEndpoint(baseUrl, isOllama);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (effectiveConfig.apiKey) headers.Authorization = `Bearer ${effectiveConfig.apiKey}`;
        if (effectiveConfig.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://reflex.app';
            headers['X-Title'] = 'Reflex';
        }

        const sanitizedMessages = request.messages.map((msg) => ({
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
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();

            try {
                const errorJson = JSON.parse(errorText);
                const failedGeneration = errorJson?.error?.failed_generation;
                if (errorJson?.error?.code === 'tool_use_failed' && failedGeneration) {
                    const funcMatch = failedGeneration.match(/<function=(\w+)>([\s\S]*)/);
                    if (funcMatch) {
                        return {
                            content: null,
                            toolCalls: [{
                                id: `call_${Date.now()}`,
                                type: 'function' as const,
                                function: {
                                    name: funcMatch[1],
                                    arguments: funcMatch[2].trim(),
                                },
                            }],
                            finishReason: 'tool_calls',
                        };
                    }
                }
            } catch {
                // Ignore and continue to regular error formatting below.
            }

            try {
                const parsed = JSON.parse(errorText);
                const code = parsed?.error?.code;
                const type = parsed?.error?.type;
                const message = parsed?.error?.message;
                const requestId = parsed?.error?.request_id || parsed?.request_id;

                if (response.status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
                    const detail = message ? ` ${message}` : '';
                    const suffix = requestId ? ` Request ID: ${requestId}` : '';
                    throw new Error(`AI service is busy right now. Please retry in a moment or switch models.${detail}${suffix}`.trim());
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
                throw new Error('AI service is busy right now. Please retry in a moment or switch models.');
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
            return {
                content: null,
                toolCalls: [{
                    id: `call_${Date.now()}`,
                    type: 'function' as const,
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
    }

    async textToCommand(naturalLanguage: string, context?: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.textToCommand },
            { role: 'user', content: context ? `Current path: ${context}\n\n${naturalLanguage}` : naturalLanguage },
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content.trim();
    }

    async analyzeError(errorText: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.errorAnalysis },
            { role: 'user', content: errorText },
        ];

        const response = await this.complete({ messages, temperature: 0.5 });
        return response.content;
    }

    async summarizeLogs(logText: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.logSummary },
            { role: 'user', content: logText },
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content;
    }

    async explainCommand(text: string): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS.explainCommand },
            { role: 'user', content: text },
        ];

        const response = await this.complete({ messages, temperature: 0.3 });
        return response.content;
    }
}

export const aiService = new AIService();
