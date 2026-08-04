import { HugeiconsIcon } from '@hugeicons/react';
import { SparklesIcon } from '@hugeicons/core-free-icons';
import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg';
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter-color.svg';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg';
import volcengineIcon from '@lobehub/icons-static-svg/icons/volcengine-color.svg';
import { cn } from '../../lib/utils';

export type ProviderMarkId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'dashscope'
  | 'ark'
  | 'deepseek'
  | 'sub2api'
  | 'custom';

const MARKS: Partial<Record<ProviderMarkId, { src: string; label: string }>> = {
  anthropic: { src: claudeIcon, label: 'Claude' },
  openai: { src: openaiIcon, label: 'OpenAI' },
  openrouter: { src: openrouterIcon, label: 'OpenRouter' },
  dashscope: { src: qwenIcon, label: 'Qwen' },
  ark: { src: volcengineIcon, label: 'Volcengine' },
  deepseek: { src: deepseekIcon, label: 'DeepSeek' },
};

/** Infers the provider mark for model controls whose options only contain model ids. */
export function providerMarkFromModel(model: string, baseUrl = ''): ProviderMarkId {
  const modelId = model.toLowerCase();
  const endpoint = baseUrl.toLowerCase();

  // Prefer the model family: an OpenRouter-hosted Claude should still look like Claude.
  if (modelId.includes('anthropic') || modelId.includes('claude')) return 'anthropic';
  if (modelId.includes('deepseek')) return 'deepseek';
  if (modelId.includes('qwen')) return 'dashscope';
  if (modelId.includes('doubao')) return 'ark';
  if (/(^|\/)(?:gpt|o[134])(?:[-\d]|$)/.test(modelId)) return 'openai';

  if (endpoint.includes('openrouter')) return 'openrouter';
  if (endpoint.includes('anthropic')) return 'anthropic';
  if (endpoint.includes('deepseek')) return 'deepseek';
  if (endpoint.includes('dashscope') || endpoint.includes('bailian')) return 'dashscope';
  if (endpoint.includes('volces') || endpoint.includes('volcengine')) return 'ark';
  if (endpoint.includes('openai')) return 'openai';
  return 'custom';
}

export function ProviderMark({ provider, className }: {
  provider: ProviderMarkId;
  className?: string;
}) {
  const mark = MARKS[provider];

  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border shadow-sm',
        provider === 'openai'
          ? 'border-black/10 bg-white'
          : 'border-white/10 bg-foreground/[0.06]',
        provider === 'custom' && 'border-primary/20 bg-primary/10 text-primary',
        provider === 'sub2api' && 'border-cyan-300/20 bg-[#10172a]',
        className,
      )}
      aria-hidden="true"
    >
      {provider === 'sub2api' ? (
        <span className="bg-gradient-to-br from-cyan-300 via-sky-400 to-violet-500 bg-clip-text text-[11px] font-black tracking-[-0.08em] text-transparent">
          S₂
        </span>
      ) : mark ? (
        <img src={mark.src} alt="" title={mark.label} className="h-[15px] w-[15px] object-contain" />
      ) : (
        <HugeiconsIcon icon={SparklesIcon} className="h-3.5 w-3.5" />
      )}
    </span>
  );
}
