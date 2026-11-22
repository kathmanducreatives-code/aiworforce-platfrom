// Company Brain V2 · B2.3 — on the dashboard: what agents have offered to remember,
// waiting for a person. Only shown when something is pending. Nothing is approved
// from here; every row opens the review queue in the Company Brain.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookmarkPlus } from 'lucide-react';
import { fetchPendingProposals } from '@/lib/companyBrain/memoryApi';
import { proposalSummary } from '@/lib/companyBrain/memoryView';

export default function MemoryReviewStrip({ workspaceId }: { workspaceId: string | null | undefined }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['brain-memory-pending', workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchPendingProposals(workspaceId as string, 3),
    staleTime: 30_000,
  });
  const total = q.data?.total ?? 0;
  if (!q.data || total === 0) return null;
  const open = () => navigate('/company-brain#brain-memory');
  return (
    <section aria-label="Things to remember" data-testid="memory-review-strip"
      className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookmarkPlus className="h-4 w-4 text-emerald-300" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">
            Your agents offered to remember {total} thing{total === 1 ? '' : 's'}
          </h2>
        </div>
        <button type="button" onClick={open} className="inline-flex items-center gap-1 text-[13px] text-emerald-300 hover:underline">
          Review in Company Brain <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-[13px] text-neutral-300">Nothing an agent suggests is used until someone on your team approves it.</p>
      <ul className="mt-2 space-y-1.5">
        {q.data.items.map((p) => {
          const s = proposalSummary(p);
          return (
            <li key={p.id}>
              <button type="button" onClick={open} className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-[13px] hover:bg-white/[0.04]">
                <span className="text-neutral-400">{s.title}: </span><span className="text-foreground">{s.value}</span>
                <span className="block text-[11.5px] text-neutral-400">{p.proposed_by_agent.toUpperCase()} · {p.rationale.slice(0, 140)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
