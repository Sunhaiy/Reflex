import styles from './StreamingText.module.css';

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const SKIPPED_TAGS = new Set(['code', 'pre', 'script', 'style']);
const TOKEN_PATTERN = /(\s+|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af])/;

function tokens(value: string): string[] {
  return value.split(TOKEN_PATTERN).filter(Boolean);
}

function countWords(node: HastNode, skipped = false): number {
  const nextSkipped = skipped || (node.tagName ? SKIPPED_TAGS.has(node.tagName) : false);
  if (node.type === 'text' && !nextSkipped) {
    return tokens(node.value ?? '').filter((token) => !/^\s+$/.test(token)).length;
  }
  return (node.children ?? []).reduce(
    (count, child) => count + countWords(child, nextSkipped),
    0,
  );
}

function decorateWords(node: HastNode, state: { index: number; total: number }, skipped = false) {
  const nextSkipped = skipped || (node.tagName ? SKIPPED_TAGS.has(node.tagName) : false);
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || nextSkipped) {
      decorateWords(child, state, nextSkipped);
      return child;
    }

    return tokens(child.value ?? '').map((token): HastNode => {
      if (/^\s+$/.test(token)) return { type: 'text', value: token };
      const fresh = state.total - state.index <= 2;
      state.index += 1;
      if (!fresh) return { type: 'text', value: token };
      return {
        type: 'element',
        tagName: 'span',
        properties: { className: [styles.word, styles.fresh] },
        children: [{ type: 'text', value: token }],
      };
    });
  });
}

/** Adds assistant-ui-style word reveals without replacing the rendered Markdown tree. */
export function rehypeStreamingText() {
  return (tree: HastNode) => {
    decorateWords(tree, { index: 0, total: countWords(tree) });
  };
}
