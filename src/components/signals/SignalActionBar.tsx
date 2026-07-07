// Reusable signal action bar. Approval-first: turning a signal into a post/comment
// creates a draft for review (never posts), and Save/Ignore/Reviewed persist to
// signal_reviews. "Convert to Workbench" is intentionally disabled here — lead
// routing is owned by a separate workstream — and says so honestly.
import { FileText, MessageSquare, Bookmark, Check, EyeOff, Boxes } from "lucide-react";
import type { ReviewStatus } from "@/lib/signalReviewModel";

export interface SignalActionHandlers {
  onTurnIntoPost?: () => void;
  onTurnIntoComment?: () => void;
  onSaveIdea?: () => void;
  onMarkReviewed?: () => void;
  onIgnore?: () => void;
}

export default function SignalActionBar({
  reviewStatus,
  handlers,
  compact,
}: {
  reviewStatus?: ReviewStatus | null;
  handlers: SignalActionHandlers;
  compact?: boolean;
}) {
  const saved = reviewStatus === "saved";
  const reviewed = reviewStatus === "reviewed";
  const ignored = reviewStatus === "ignored";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ActionBtn primary icon={FileText} label="Turn into post" onClick={handlers.onTurnIntoPost} />
      <ActionBtn icon={MessageSquare} label="Turn into comment" onClick={handlers.onTurnIntoComment} />
      <ActionBtn icon={Bookmark} label={saved ? "Saved" : "Save idea"} active={saved} onClick={handlers.onSaveIdea} />
      {!compact && <ActionBtn icon={Check} label={reviewed ? "Reviewed" : "Mark reviewed"} active={reviewed} onClick={handlers.onMarkReviewed} />}
      <ActionBtn icon={EyeOff} label={ignored ? "Ignored" : "Ignore"} active={ignored} onClick={handlers.onIgnore} />
      {/* Disabled honestly — lead routing handled by a separate workstream. */}
      <ActionBtn
        icon={Boxes}
        label="Convert to Workbench"
        disabled
        title="Lead routing to Workbench is handled separately — coming soon."
      />
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  primary,
  active,
  disabled,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const cls = disabled
    ? "border-white/[0.06] bg-white/[0.01] text-neutral-600 cursor-not-allowed"
    : primary
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/[0.16]"
      : active
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        : "border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-white/[0.05] hover:text-[#F0F6FC]";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
