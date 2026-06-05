import { Copy, Check, X, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { decideApproval, type DBApproval } from '@/lib/orchestration';
import { normalizePennDrafts } from './normalize';
import RawJsonView from './RawJsonView';

const APPROVAL_TONE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function PennDraftView({ output, approval }: { output: any; approval: DBApproval | null }) {
  const drafts = normalizePennDrafts(output);
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null);

  const handleApproval = async (action: 'approve' | 'reject') => {
    if (!approval || pendingAction) return;
    setPendingAction(action);
    try {
      await decideApproval(approval.id, action);
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
    } catch (e) {
      toast.error('Could not update approval', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-3">
      {approval && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[12px] text-[#F0F6FC] truncate">{approval.title}</div>
            {approval.description && (
              <div className="text-[11px] text-[#7D8590] truncate">{approval.description}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-md border ${APPROVAL_TONE[approval.status] ?? APPROVAL_TONE.pending}`}>
              {approval.status}
            </span>
            {approval.status === 'pending' && (
              <>
                <button
                  onClick={() => handleApproval('approve')}
                  disabled={!!pendingAction}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {pendingAction === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Approve
                </button>
                <button
                  onClick={() => handleApproval('reject')}
                  disabled={!!pendingAction}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  {pendingAction === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {drafts.length === 0 && (
        <div className="text-[12px] text-[#7D8590]">No structured draft detected.</div>
      )}

      {drafts.map((d, i) => {
        const copyText = `${d.subject ?? ''}\n\n${d.body ?? ''}`.trim();
        return (
          <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Draft {i + 1}</div>
              <button
                onClick={() => { navigator.clipboard.writeText(copyText); toast.success('Copied'); }}
                className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-[#C9D1D9]"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            {d.subject && (
              <div className="text-[13px] text-[#F0F6FC] font-medium">{d.subject}</div>
            )}
            {d.body && (
              <div className="text-[12px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">{d.body}</div>
            )}
            {d.linkedin && (
              <div className="border-t border-white/[0.06] pt-2 mt-2">
                <div className="text-[10px] uppercase tracking-widest text-[#7D8590] mb-1">LinkedIn note</div>
                <div className="text-[12px] text-[#C9D1D9] whitespace-pre-wrap">{d.linkedin}</div>
              </div>
            )}
            {d.personalization && (
              <div className="text-[11px] text-[#7D8590] italic">Notes: {d.personalization}</div>
            )}
          </div>
        );
      })}

      <RawJsonView data={output} />
    </div>
  );
}
