// AI Service Types for SSH Tool

export type AIProvider = 'deepseek' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama' | 'qwen' | 'custom';

export interface AIConfig {
    provider: AIProvider;
    apiKey: string;
    baseUrl?: string; // For custom providers
    model?: string;
    privacyMode: boolean;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface AICompletionRequest {
    messages: ChatMessage[];
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
}

export interface AICompletionResponse {
    content: string;
    finishReason?: string;
}

// Function Calling types
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolCompletionResponse {
    content: string | null;
    toolCalls: ToolCall[] | null;
    finishReason: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    modelUsed?: string;
}

// Agent tools definition
export const AGENT_TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'execute_ssh_command',
            description: '在远程 Linux 服务器上通过 SSH 执行一条 Shell 命令，返回 stdout、stderr 和 exitCode。每次只能执行一条命令。',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: '要执行的 Linux Shell 命令，例如 "df -h"、"systemctl status nginx"'
                    }
                },
                required: ['command']
            }
        }
    }
];

// Default configurations for each provider
export const AI_PROVIDER_CONFIGS: Record<AIProvider, { baseUrl: string; defaultModel: string; displayName: string; hasFreeTier: boolean; note?: string }> = {
    groq: {
        baseUrl: 'https://api.groq.com/openai',
        defaultModel: 'llama-3.3-70b-versatile',
        displayName: 'Groq (免费)',
        hasFreeTier: true,
        note: '每分钟 30 请求免费'
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api',
        defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
        displayName: 'OpenRouter (部分免费)',
        hasFreeTier: true,
        note: '部分模型免费'
    },
    ollama: {
        baseUrl: 'http://localhost:11434',
        defaultModel: 'llama3.2',
        displayName: 'Ollama (本地)',
        hasFreeTier: true,
        note: '需本地安装 Ollama'
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        displayName: 'DeepSeek',
        hasFreeTier: false
    },
    openai: {
        baseUrl: 'https://api.openai.com',
        defaultModel: 'gpt-4o-mini',
        displayName: 'OpenAI',
        hasFreeTier: false
    },
    anthropic: {
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-3-haiku-20240307',
        displayName: 'Anthropic',
        hasFreeTier: false
    },
    qwen: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen-plus',
        displayName: '通义千问 (AliCloud)',
        hasFreeTier: true,
        note: '新用户有免费额度'
    },
    custom: {
        baseUrl: '',
        defaultModel: '',
        displayName: '自定义 (Custom)',
        hasFreeTier: false,
        note: '支持任何 OpenAI 兼容 API'
    }
};

// System prompts for different AI features
export const AI_SYSTEM_PROMPTS = {
    textToCommand: `你是一个 Linux/Unix 命令行专家。用户会用自然语言描述他们想做的事情，你需要将其转换为对应的 Shell 命令。

规则：
1. 只输出命令，不要解释
2. 如果需要多个命令，用 && 或 ; 连接
3. 使用常见的、跨平台兼容的命令
4. 如果涉及危险操作（如 rm -rf），请在命令前加注释警告

示例：
用户：查找当前目录下大于100M的文件
输出：find . -type f -size +100M -exec ls -lh {} \\;`,

    errorAnalysis: `你是一个专业的系统管理员和故障排查专家。用户会给你一段错误日志或报错信息，你需要：

1. 解释这个错误是什么意思
2. 分析可能的原因（列出 2-3 个最可能的）
3. 提供修复建议
4. 如果有具体的修复命令，用 \`\`\`bash\`\`\` 代码块包裹

回答要简洁专业，使用中文。`,

    logSummary: `你是一个日志分析专家。用户会给你一段系统日志，请：

1. 用 1-2 句话总结日志的主要内容
2. 指出是否有异常或错误
3. 如果有问题，给出检查建议

保持简洁，重点突出。`,

    explainCommand: `你是一个 Linux/Unix 技术专家。用户会提供一段终端输出或一个 Shell 命令，你需要：

1. 如果是命令：详细解释该命令的目的及每个参数的作用。
2. 如果是终端输出/日志：解释其含义，指出是否正常，如果有错误，简要说明原因。

回答要简洁专业，使用中文，字数控制在 200 字以内。`,

    agent: `你是一个专业的 Linux 服务器管理助手（Agent）。你通过 SSH 连接直接管理用户的服务器。

你拥有一个工具：execute_ssh_command，可以在服务器上执行任意 Shell 命令。系统会自动将命令输出返回给你。

## 工作方式

1. **思考**：分析用户的需求，决定下一步需要什么信息或操作
2. **执行**：调用 execute_ssh_command 执行一条命令
3. **观察**：阅读命令输出，分析结果
4. **循环**：根据结果决定是继续执行下一步，还是向用户汇报

## 规则

- 每次只调用一个命令，观察结果后再决定下一步
- 先用只读命令（ls、cat、df、ps 等）了解情况，再做修改操作
- 对于危险操作（rm -rf、shutdown、数据库删除等），先用文字告知用户风险，不要直接执行
- 用简洁的中文解释你在做什么、结果如何
- 如果命令出错，分析原因并尝试其他方案`
};

