import { ExternalLink, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeFirecrawl } from './normalize';
import RawJsonView from './RawJsonView';

export default function HawkResearchView({ output }: { output: any }) {
  const fc = normalizeFirecrawl(output);
  const md = fc.markdown ?? '';
  const summary = fc.summary;

  return (
    <div className="space-y-3">
      {(fc.title || fc.url) && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          {fc.title && <div className="text-[13px] text-[#F0F6FC] font-medium">{fc.title}</div>}
          {fc.url && (
            <a
              href={fc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 break-all"
            >
              {fc.url} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590] mb-1">Summary</div>
          <div className="text-[13px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">{summary}</div>
        </div>
      )}

      {md && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Extracted content</div>
            <button
              onClick={() => { navigator.clipboard.writeText(md); toast.success('Copied'); }}
              className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-[#C9D1D9]"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <pre className="text-[12px] text-[#C9D1D9] whitespace-pre-wrap break-words max-h-[420px] overflow-auto">
            {md}
          </pre>
        </div>
      )}

      {Array.isArray(fc.citations) && fc.citations.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590] mb-1">Sources</div>
          <ul className="space-y-1">
            {fc.citations.map((c, i) => (
              <li key={i}>
                <a
                  href={c}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-emerald-300 hover:text-emerald-200 break-all"
                >
                  {c}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RawJsonView data={output} />
    </div>
  );
}
