import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';

export function isSafeExternalLink(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** GFM's bare-URL extension can consume closing strong markers. Normalise this common
 * model pattern so `**https://…**` never leaks literal asterisks into the card. */
export function normaliseAgentMarkdown(source: string): string {
  let fence: '`' | '~' | null = null;
  return source.split('\n').map((line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (fence === marker) fence = null;
      else if (fence === null) fence = marker;
      return line;
    }
    if (fence) return line;

    const inlineCode: string[] = [];
    const protectedLine = line.replace(/(`+)(.*?)\1/g, (match) => {
      const index = inlineCode.push(match) - 1;
      return `\u0000agent-code-${index}\u0000`;
    });
    return protectedLine
      .replace(/\*\*((https?:\/\/[^\s*]+))\*\*/g, '[$1]($1)')
      .replace(/\u0000agent-code-(\d+)\u0000/g, (_, index: string) => inlineCode[Number(index)]);
  }).join('\n');
}

function plainText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(plainText).join('');
  return '';
}

function MarkdownCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = plainText(children).replace(/\n$/, '');
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  const multiline = Boolean(language) || value.includes('\n');

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!multiline) {
    return (
      <code className="rounded bg-foreground/[0.07] px-1 py-0.5 font-mono text-[0.92em] text-foreground/90">
        {children}
      </code>
    );
  }

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1_600);
    }).catch(() => undefined);
  };

  return (
    <div
      data-agent-code-block
      className="my-2 overflow-hidden rounded-lg border border-border/55 bg-background/55"
    >
      <div className="flex h-8 items-center justify-between border-b border-border/45 px-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground/75">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="h-3 w-3" />
          {copied ? t('agent.copied') : t('agent.copy')}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-2.5 font-mono text-[10.5px] leading-[1.55] text-foreground/85">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function AgentMarkdown({
  source,
  streaming = false,
  className,
}: {
  source: string;
  streaming?: boolean;
  className?: string;
}) {
  const normalisedSource = normaliseAgentMarkdown(source);
  const deferredSource = useDeferredValue(normalisedSource);
  const renderedSource = streaming ? deferredSource : normalisedSource;

  const components = useMemo<Components>(() => ({
    h1: ({ children }) => <h1 className="mb-2 mt-3 text-[15px] font-semibold first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[14px] font-semibold first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-[13px] font-semibold first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-2 text-[12px] font-semibold first:mt-0">{children}</h4>,
    p: ({ children }) => <p className="my-1.5 break-words first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-primary/45 pl-2.5 text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-border/55" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    pre: ({ children }) => <Fragment>{children}</Fragment>,
    code: ({ className: codeClassName, children }) => (
      <MarkdownCode className={codeClassName}>{children}</MarkdownCode>
    ),
    table: ({ children }) => (
      <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-border/55">
        <table className="w-max min-w-full border-collapse text-left text-[10.5px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-foreground/[0.045]">{children}</thead>,
    th: ({ children }) => <th className="border-b border-r border-border/45 px-2 py-1.5 font-medium last:border-r-0">{children}</th>,
    td: ({ children }) => <td className="border-b border-r border-border/35 px-2 py-1.5 align-top last:border-r-0">{children}</td>,
    a: ({ href, children }) => {
      if (!isSafeExternalLink(href)) return <span>{children}</span>;
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            void window.electron.openExternal(href!);
          }}
          className="text-primary underline decoration-primary/35 underline-offset-2 transition-colors hover:decoration-primary"
        >
          {children}
        </a>
      );
    },
    img: ({ alt }) => <span className="text-muted-foreground">{alt ?? ''}</span>,
  }), []);

  return (
    <div className={cn('min-w-0 break-words text-[12px] leading-[1.65] text-foreground/90', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {renderedSource}
      </ReactMarkdown>
    </div>
  );
}
