// Renders the safe Markdown subset (lib/miniMarkdown.ts) as React elements — no HTML injection.
import { Fragment } from 'react';
import { looksLikeMarkdown, parseMarkdown, type Inline } from '@/lib/miniMarkdown';

const runs = (xs: Inline[]) => xs.map((x, i) => x.bold ? <strong key={i} className="font-semibold text-foreground">{x.text}</strong> : <Fragment key={i}>{x.text}</Fragment>);

export default function MarkdownText({ text }: { text: string }) {
  if (!looksLikeMarkdown(text)) return <>{text}</>;
  return (
    <div className="space-y-2 whitespace-normal" data-testid="markdown-text">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === 'h') {
          const cls = b.level === 1 ? 'text-[15px] font-semibold' : b.level === 2 ? 'text-[14px] font-semibold' : 'text-[13.5px] font-semibold';
          return <p key={i} role="heading" aria-level={b.level} className={cls}>{runs(b.inline)}</p>;
        }
        if (b.type === 'ul') return <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{runs(it)}</li>)}</ul>;
        if (b.type === 'ol') return <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{runs(it)}</li>)}</ol>;
        return <p key={i}>{runs(b.inline)}</p>;
      })}
    </div>
  );
}
