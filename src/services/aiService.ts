// AI Service - Handles communication with AI providers (DeepSeek, OpenAI, etc.)

import { AIConfig, AICompletionRequest, AICompletionResponse, AI_PROVIDER_CONFIGS, ChatMessage } from '../shared/aiTypes';

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
            content: this.sanitize(msg.content)
        }));

        // Choose endpoint and headers based on provider
        const isOllama = this.config.provider === 'ollama';
        const endpoint = isOllama
            ? `${baseUrl}/api/chat`
            : `${baseUrl}/v1/chat/completions`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (!isOllama && this.config.apiKey) {
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
        if (!this.config || !this.config.apiKey) {
            throw new Error('AI service not configured. Please set your API key in Settings.');
        }

        const providerConfig = AI_PROVIDER_CONFIGS[this.config.provider];
        const baseUrl = this.config.baseUrl || providerConfig.baseUrl;
        const model = this.config.model || providerConfig.defaultModel;

        // Sanitize messages if privacy mode is on
        const sanitizedMessages = request.messages.map(msg => ({
            ...msg,
            content: this.sanitize(msg.content)
        }));

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: sanitizedMessages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 2048,
                stream: true
            })
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
                        const content = parsed.choices?.[0]?.delta?.content;
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

    // Helper: Text to command
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
}

// Singleton instance
export const aiService = new AIService();
