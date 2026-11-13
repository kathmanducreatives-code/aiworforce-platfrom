// The evidence behind one ORION answer: what each [E#] in the reply refers to,
// where it came from, how old it is, and whether it is verified, single-source,
// stale or contradicted. Rendered only when the server attached evidence
// (AGENTORY_ORION_EVIDENCE_CONTEXT); otherwise nothing changes.
import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { ageText, readOrionEvidence, type EvidenceTone } from '@/lib/chat/orionEvidence';

const TONE_CLASS: Record<EvidenceTone, string> = {
  verified: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/30',
  single: 'bg-amber-300/15 text-amber-100 border-amber-200/30',
  inference: 'bg-sky-300/15 text-sky-100 border-sky-200/30',
  stale: 'bg-zinc-400/15 text-zinc-200 border-zinc-300/30',
  contradicted: 'bg-rose-400/15 text-rose-200 border-rose-300/30',
  unknown: 'bg-zinc-400/10 text-zinc-300 border-zinc-300/20',
};

export default function OrionEvidencePanel({ metadata }: { metadata: unknown }) {
  const rows = readOrionEvidence(metadata);
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const warn = rows.filter((r) => r.tone === 'stale' || r.tone === 'contradicted' || r.tone === 'single').length;
  return (
    <div className="mt-2 max-w-[720px] rounded-xl border border-white/[0.08] bg-white/[0.02]" data-testid="orion-evidence">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px] text-[#B9BEC6] hover:text-[#ECE9E4]">
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        Evidence · {rows.length} record{rows.length === 1 ? '' : 's'}
        {warn > 0 && <span className="ml-1 text-amber-200/90">· {warn} need{warn === 1 ? 's' : ''} caution</span>}
        <span className="ml-auto text-[11.5px] text-[#7D8590]">stored workspace records · no live web search</span>
      </button>
      {open && (
        <ol className="space-y-2 border-t border-white/[0.06] px-3 py-2.5" data-testid="orion-evidence-list">
          {rows.map((r) => (
            <li key={r.ref} className="text-[12.5px] leading-snug text-[#D9D6D0]" data-testid={`orion-evidence-${r.ref}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11.5px] text-[#9AA0A8]">[{r.ref}]</span>
                <span className="font-medium text-[#F2EFEA]">{r.subject}</span>
                <span className={`rounded-full border px-1.5 py-[1px] text-[11px] ${TONE_CLASS[r.tone]}`}>{r.label}</span>
                {r.excludedBy && (
                  <span className="rounded-full border border-rose-300/30 bg-rose-400/10 px-1.5 py-[1px] text-[11px] text-rose-200">
                    excluded: {r.excludedBy}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[#C9C6C0]">{r.content}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[#8B8F96]">
                <span>{r.sourceType}</span>
                <span>{r.date ?? 'undated'} · {ageText(r.ageDays)}</span>
                {r.sourceUrl ? (
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 hover:text-[#ECE9E4]">
                    {r.sourceHost ?? 'source'} <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : r.sourceHost ? <span>{r.sourceHost}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
