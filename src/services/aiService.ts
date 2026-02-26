// AI Service - Handles communication with AI providers (DeepSeek, OpenAI, etc.)

import { AIConfig, AICompletionRequest, AICompletionResponse, AI_PROVIDER_CONFIGS, ChatMessage, ToolDefinition, ToolCall, ToolCompletionResponse, AIProviderProfile } from '../shared/aiTypes';

class AIService {
    private config: AIConfig | null = null;

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
            if (cleanBase.endsWith('/v1/chat/completions')) return cleanBase;
            // Handle common base URL suffix provided by many proxies
            if (cleanBase.endsWith('/v1')) return `${cleanBase}/chat/completions`;
            return `${cleanBase}/v1/chat/completions`;
        }
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

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`AI request failed: ${error}`);
        }

        const data = await response.json();

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

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`AI request failed: ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;

                    try {
                        const parsed = JSON.parse(data);

                        // Ollama format is slightly different 
                        const content = isOllama
                            ? parsed.message?.content
                            : parsed.choices?.[0]?.delta?.content;

                        if (content) {
                            yield content;
                        }
                    } catch (e) {
                        // Ignore parse errors for incomplete JSON
                    }
                }
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

        const response = await fetch(endpoint, {
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

            throw new Error(`AI request failed: ${errorText}`);
        }

        const data = await response.json();
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
