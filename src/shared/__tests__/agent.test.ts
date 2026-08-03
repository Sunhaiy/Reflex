import { describe, expect, it } from 'vitest';
import { isChatModel } from '../agent';

describe('isChatModel', () => {
  it('keeps the chat models a gateway actually serves', () => {
    // Taken from a real Sub2API whitelist — the point of the filter is this list.
    const keep = [
      'gpt-5.5', 'gpt-5.6', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra',
      'gpt-5.2', 'gpt-5.2-pro', 'gpt-5.2-pro-2025-12-11', 'gpt-5.2-chat-latest',
      'gpt-5.3-codex-spark', 'gpt-5.4-mini', 'codex-auto-review',
    ];
    for (const id of keep) expect(isChatModel(id), id).toBe(true);
  });

  it('drops what could only be a mistake in this field', () => {
    const drop = [
      'gpt-image-1', 'gpt-image-1.5', 'gpt-image-2',
      'gpt-4o-audio-preview', 'gpt-4o-realtime-preview',
      'text-embedding-3-large', 'whisper-1', 'tts-1-hd',
      'dall-e-3', 'omni-moderation-latest', 'sora-2',
    ];
    for (const id of drop) expect(isChatModel(id), id).toBe(false);
  });

  it('keeps vendor-prefixed ids from a router', () => {
    const keep = [
      'anthropic/claude-opus-4.5', 'deepseek/deepseek-v4-pro', 'z-ai/glm-4.7',
      'moonshotai/kimi-k2-thinking', 'qwen/qwen3-coder-plus',
    ];
    for (const id of keep) expect(isChatModel(id), id).toBe(true);
  });

  it('drops vendor-prefixed non-chat models too', () => {
    expect(isChatModel('openai/gpt-4o-audio-preview')).toBe(false);
    expect(isChatModel('openai/text-embedding-3-small')).toBe(false);
  });

  it('does not mistake a name that merely contains a keyword', () => {
    // `imagen` is a generator, but `reimagine-chat` is not — and a model whose name
    // happens to contain "video" as part of a longer word must survive.
    expect(isChatModel('claude-vision-preview')).toBe(true);
    expect(isChatModel('qwen-vl-max')).toBe(true);
    expect(isChatModel('glm-4-voicechat')).toBe(true);
  });
});
