// Drafts awaiting the founder's approval. Real saved_outputs / outreach_drafts
// only. Every item is review-first — nothing here posts or sends automatically.
import { FileText, CheckCircle2, AlertCircle, ShieldAlert, Send, Inbox } from "lucide-react";
import { DRAFT_STATUS_LABELS, type DraftReviewStatus } from "@/lib/contentOps";

export interface QueueDraft {
  id: string;
  title: string;
  format: string;
  status: DraftReviewStatus;
  date?: string | null;
  preview?: string | null;
  sourceUrl?: string | null;
}

const STATUS_STYLE: Record<DraftReviewStatus, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft_ready:     { className: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: FileText },
  needs_review:    { className: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: AlertCircle },
  needs_proof:     { className: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: ShieldAlert },
  approved:        { className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2 },
  manually_posted: { className: "border-white/15 bg-white/5 text-neutral-300", icon: Send },
};

export default function DraftApprovalQueue({ drafts, onOpen }: { drafts: QueueDraft[]; onOpen?: (id: string) => void }) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-neutral-500">
        <Inbox className="h-6 w-6" />
        <div className="text-[13px] max-w-sm">No drafts awaiting approval. Turn a signal into a post or comment and it will appear here for your review.</div>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {drafts.map((d) => {
        const st = STATUS_STYLE[d.status];
        const Icon = st.icon;
        return (
          <li key={d.id}>
            <button onClick={() => onOpen?.(d.id)} className="w-full text-left rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 hover:border-white/[0.14] transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">{d.format}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${st.className}`}>
                  <Icon className="h-3 w-3" /> {DRAFT_STATUS_LABELS[d.status]}
                </span>
              </div>
              <div className="text-[14px] font-medium text-[#F0F6FC] mt-1 line-clamp-1">{d.title}</div>
              {d.preview && <div className="text-[12px] text-neutral-400 mt-1 line-clamp-2 whitespace-pre-wrap">{d.preview}</div>}
              <div className="mt-2 text-[11px] text-neutral-500">Review, edit, then publish manually — nothing is sent for you.</div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
