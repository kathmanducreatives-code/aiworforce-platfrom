import { detectShape, unwrapList } from '@/lib/outputShape';
import { Copy, Mail, Users, AlertCircle, FileText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function CopyBtn({ payload }: { payload: string }) {
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(payload); toast.success('Copied'); }}
      className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
      type="button"
    >
      <Copy className="h-3 w-3" /> Copy
    </button>
  );
}

function CandidateList({ output }: { output: any }) {
  const items = unwrapList<any>(output, 'candidates');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><Users className="h-3 w-3" />{items.length} candidates</div>
      <div className="grid gap-2">
        {items.slice(0, 8).map((c, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
              <div className="text-xs text-muted-foreground truncate">{c.title ?? c.role} {c.company ? `· ${c.company}` : ''}</div>
            </div>
            {typeof c.score === 'number' && (
              <div className="text-xs font-semibold text-primary bg-primary/10 border border-primary/30 rounded-md px-2 py-0.5 shrink-0 ml-3">
                {Math.round(c.score)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailList({ output }: { output: any }) {
  const items = unwrapList<any>(output, 'emails');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><Mail className="h-3 w-3" />{items.length} emails</div>
      <div className="space-y-1.5">
        {items.map((e, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-background/50 overflow-hidden">
            <button onClick={() => setOpen(open === i ? null : i)} className="w-full text-left px-3 py-2 hover:bg-foreground/5 transition-colors">
              <div className="text-sm text-foreground truncate">{e.subject ?? '(no subject)'}</div>
              {e.to && <div className="text-[11px] text-muted-foreground truncate">to {e.to}</div>}
            </button>
            {open === i && (
              <div className="px-3 pb-3 pt-1 border-t border-border/40 text-sm text-foreground/90 whitespace-pre-wrap">
                {e.body ?? e.html ?? ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalList({ output }: { output: any }) {
  const items = unwrapList<any>(output, 'signals');
  const sevTone = (s: string) => s === 'high' ? 'bg-red-500' : s === 'medium' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><AlertCircle className="h-3 w-3" />{items.length} signals</div>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${sevTone(s.severity)}`} />
            <span className="text-foreground/90">{s.title ?? s.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntelReport({ output }: { output: any }) {
  const summary: string | undefined = output.summary;
  const sections: any[] = Array.isArray(output.sections) ? output.sections : [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><Sparkles className="h-3 w-3" />Intel report</div>
      {summary && <p className="text-sm text-foreground/90 leading-relaxed">{summary}</p>}
      {sections.map((sec, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-background/50 p-3">
          <div className="text-xs font-semibold text-foreground mb-1">{sec.title}</div>
          <div className="text-sm text-foreground/85 whitespace-pre-wrap">{sec.body}</div>
        </div>
      ))}
    </div>
  );
}

function ContentBlock({ output }: { output: any }) {
  const text = typeof output === 'string' ? output : (output.text ?? output.markdown ?? output.content ?? '');
  return (
    <div className="space-y-2 relative group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><FileText className="h-3 w-3" />Content</div>
        <CopyBtn payload={text} />
      </div>
      <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function RawBlock({ output }: { output: any }) {
  const json = JSON.stringify(output, null, 2);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(!open)} className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
          {open ? 'Hide' : 'Show'} raw output
        </button>
        <CopyBtn payload={json} />
      </div>
      {open && (
        <pre className="text-[11px] bg-background/60 border border-border/60 rounded-lg p-2 overflow-auto max-h-72 text-foreground/80">
          {json}
        </pre>
      )}
    </div>
  );
}

export default function OutputRenderer({ output }: { output: any }) {
  if (output == null) return <div className="text-sm text-muted-foreground italic">No output</div>;
  const shape = detectShape(output);
  switch (shape) {
    case 'candidates': return <CandidateList output={output} />;
    case 'emails':     return <EmailList output={output} />;
    case 'signals':    return <SignalList output={output} />;
    case 'intel':      return <IntelReport output={output} />;
    case 'content':    return <ContentBlock output={output} />;
    default:           return <RawBlock output={output} />;
  }
}

export { Button };
