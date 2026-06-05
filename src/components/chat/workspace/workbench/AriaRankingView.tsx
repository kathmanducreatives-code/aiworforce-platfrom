import { normalizeAriaRankings } from './normalize';
import RawJsonView from './RawJsonView';

const TIER_TONE: Record<string, string> = {
  Hot: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  Warm: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Maybe: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Ignore: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
};

function tierFromScore(score?: number): string | undefined {
  if (typeof score !== 'number') return undefined;
  if (score >= 80) return 'Hot';
  if (score >= 60) return 'Warm';
  if (score >= 40) return 'Maybe';
  return 'Ignore';
}

export default function AriaRankingView({ output }: { output: any }) {
  const rankings = normalizeAriaRankings(output);

  if (rankings.length === 0) {
    // Maybe plain text
    if (typeof output === 'string' || output?.text || output?.markdown) {
      const text = typeof output === 'string' ? output : (output.text ?? output.markdown);
      return (
        <div className="space-y-3">
          <div className="text-[13px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">{text}</div>
          <RawJsonView data={output} />
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="text-[12px] text-[#7D8590]">Aria has no structured rankings yet.</div>
        <RawJsonView data={output} defaultOpen />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-[#7D8590]">{rankings.length} ranked</div>
      <ul className="space-y-2">
        {rankings.map((r, i) => {
          const tier = r.tier ?? tierFromScore(r.score);
          const tone = tier ? TIER_TONE[tier] ?? TIER_TONE.Ignore : TIER_TONE.Ignore;
          return (
            <li
              key={i}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#F0F6FC] font-medium truncate">
                    {r.name ?? 'Unnamed'}
                  </div>
                  {r.company && (
                    <div className="text-[11px] text-[#7D8590] truncate">{r.company}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {tier && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-md border ${tone}`}>
                      {tier}
                    </span>
                  )}
                  {typeof r.score === 'number' && (
                    <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-0.5">
                      {Math.round(r.score)}
                    </span>
                  )}
                </div>
              </div>
              {r.fit && <div className="text-[12px] text-[#C9D1D9]"><span className="text-[#7D8590]">Fit:</span> {r.fit}</div>}
              {r.risk && <div className="text-[12px] text-amber-300/90"><span className="text-[#7D8590]">Risk:</span> {r.risk}</div>}
              {r.next && <div className="text-[12px] text-emerald-300/90"><span className="text-[#7D8590]">Next:</span> {r.next}</div>}
            </li>
          );
        })}
      </ul>
      <RawJsonView data={output} />
    </div>
  );
}
