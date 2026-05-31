import type { DBApproval } from '@/lib/orchestration';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';

export default function ApprovalBadge({ approval, onReview }: { approval?: DBApproval | null; onReview?: () => void }) {
  if (!approval) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] bg-amber-500/10 text-amber-300 border-amber-500/20">
        <ShieldAlert className="h-3 w-3" /> Approval required
      </span>
    );
  }
  if (approval.status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
  }
  if (approval.status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] bg-rose-500/10 text-rose-300 border-rose-500/20">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] bg-amber-500/10 text-amber-300 border-amber-500/20">
      <ShieldAlert className="h-3 w-3" />
      Pending approval
      {onReview && (
        <button
          type="button"
          onClick={onReview}
          className="ml-1 underline underline-offset-2 hover:text-amber-200"
        >
          Review
        </button>
      )}
    </span>
  );
}
