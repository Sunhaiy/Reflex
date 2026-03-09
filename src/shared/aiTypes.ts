// AI Service Types for SSH Tool

export type AIProvider = 'deepseek' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama' | 'qwen' | 'custom';

export interface AIConfig {
    provider: AIProvider;
    apiKey: string;
    baseUrl?: string; // For custom providers
    model?: string;
    privacyMode: boolean;
}

// Multi-provider profile — each saves a complete API endpoint config
export interface AIProviderProfile {
    id: string;             // uuid
    name: string;           // User-facing label, e.g. "DeepSeek V3", "My GPT-4o"
    provider: AIProvider;   // provider type for endpoint routing
    apiKey: string;
    baseUrl: string;        // auto-filled from AI_PROVIDER_CONFIGS or manual
    model: string;          // e.g. 'deepseek-chat', 'gpt-4o'
    isDefault?: boolean;    // the one used when nothing is explicitly selected
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
    reasoningContent?: string | null;  // DeepSeek reasoning_content
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
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '通过 SFTP 读取远程服务器上的文件内容。用于查看配置文件、源代码等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件的绝对路径，例如 "/etc/nginx/nginx.conf"'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: '通过 SFTP 将内容写入远程服务器上的文件。用于创建或修改配置文件、源代码等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件的绝对路径，例如 "/etc/nginx/conf.d/app.conf"'
                    },
                    content: {
                        type: 'string',
                        description: '要写入的文件内容'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: '通过 SFTP 列出远程服务器上某个目录的文件和子目录列表。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '目录的绝对路径，例如 "/var/www/html"'
                    }
                },
                required: ['path']
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

    agent: `你是一个高度自主的 Linux 服务器管理 Agent。你通过 SSH 连接直接操控用户的服务器，目标是**不依赖用户干预**地完成一切任务。

## 可用工具

- **execute_ssh_command** — 在服务器执行任意 Shell 命令
- **read_file** — 通过 SFTP 读取文件
- **write_file** — 通过 SFTP 写入或创建文件
- **list_directory** — 列出目录内容

## 核心原则

### 1. 极致自主，不打扰用户
- **绝不**因"不确定怎么做"而停下来问用户。先查、先试、先查资料。
- 遇到报错或失败，立刻分析原因，换方案再试，直到成功。
- 用户批准了一个任务，就说明你有权执行完整个任务的所有步骤，不要每步都等确认。

### 2. 探索优先，再动手
- 修改任何配置前，先用 read_file 或 cat 查看当前内容。
- 操作目录前先 ls，了解文件结构再行动。
- 不确定命令位置时，先 which / command -v / find 定位。

### 3. 失败后自愈
- 命令报错 → 分析 stderr → 调整参数或换方案 → 继续。
- 权限不足 → 试 sudo，或查找有权限的替代路径。
- 包不存在 → 先 apt-get update 再安装，或换包名，或从源码安装。
- 文件被占用 → 先 lsof 查进程，再决定 kill 还是等待。
- 服务未启动 → systemctl start，看 status，查 journal 日志。

### 4. 自主决策，无需确认的操作
以下操作**不需要询问用户**即可执行：
- 读取任何文件和日志
- 安装软件包
- 启动 / 停止 / 重启服务
- 修改配置文件（修改前备份）
- 创建目录和文件
- 设置权限 chmod / chown

### 5. 必须暂停的唯一场景
只有以下情况才停下来告知用户，**其他一切自己解决**：
- 需要用户提供的密码、API Key、证书等凭据（你无法猜测）
- 操作会**永久删除无法恢复的数据**（rm -rf 大量文件、drop database 等）
- 操作会导致服务中断且无法自动恢复（如关闭唯一 SSH 入口）

### 6. 汇报风格
- 操作前一句话说明意图，操作后简洁汇报结果。
- 遇到问题不要长篇解释，先解决，解决后再说发生了什么和怎么修的。
- 全部完成后给用户一个简洁的结果摘要。`

};

