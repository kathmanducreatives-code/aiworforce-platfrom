import { ExternalLink, Sparkles, MessageSquare, Send, Search, FileText, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { buildActionCommand, signalTypeLabel, type FeedSignal, type SignalAction } from "@/lib/signalFeedModel";

function sendToPilot(text: string, label: string) {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: text }));
  toast.success(`Sent to Pilot: ${label}`);
}

const TYPE_BADGE: Record<string, string> = {
  competitor_engagement: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  linkedin_engagement: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  hiring_signal: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  people_profile: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

const PRIORITY_BADGE: Record<string, string> = {
  hot: "border-red-500/40 bg-red-500/10 text-red-300",
  warm: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  maybe: "border-white/15 bg-white/5 text-neutral-300",
  ignore: "border-white/10 bg-white/[0.03] text-neutral-500",
};

export default function SignalCard({
  signal,
  onIgnore,
  reviewed,
}: {
  signal: FeedSignal;
  onIgnore?: (id: string) => void;
  reviewed?: boolean;
}) {
  const isLinkedIn = signal.signal_type === "linkedin_engagement" || signal.signal_type === "competitor_engagement";
  const actions: { action: SignalAction; label: string; icon: any }[] = [
    ...(isLinkedIn ? [
      { action: "draft_comment" as SignalAction, label: "Draft comment", icon: MessageSquare },
      { action: "draft_dm" as SignalAction, label: "Draft DM", icon: Send },
    ] : []),
    { action: "enrich", label: "Enrich", icon: Search },
    { action: "create_outreach", label: "Draft outreach", icon: FileText },
  ];

  return (
    <li className={`rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 ${reviewed ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[signal.signal_type] ?? "border-white/15 bg-white/5 text-neutral-300"}`}>
          {signalTypeLabel(signal.signal_type)}
        </span>
        {signal.priority && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[signal.priority.toLowerCase()] ?? "border-white/15 bg-white/5 text-neutral-300"}`}>
            {signal.priority}
          </span>
        )}
        {signal.competitor_name && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
            competitor: {signal.competitor_name}{signal.competitor_source === "ai_inferred" ? " (inferred)" : ""}
          </span>
        )}
        {signal.conversation_type && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-neutral-400">{signal.conversation_type.replace(/_/g, " ")}</span>
        )}
        {signal.created_at && (
          <span className="ml-auto text-[10px] text-neutral-500">{new Date(signal.created_at).toLocaleDateString()}</span>
        )}
      </div>

      <div className="text-[13px] text-[#F0F6FC] font-medium">{signal.title}</div>
      {signal.signal_label && signal.signal_label !== signal.title && (
        <div className="text-[11px] text-neutral-400">{signal.signal_label}</div>
      )}
      {signal.description && (
        <div className="text-[12px] text-[#C9D1D9] mt-1 line-clamp-3">{signal.description}</div>
      )}

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {signal.source_url && (
          <a href={signal.source_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-sky-300 hover:bg-sky-500/[0.06]">
            <ExternalLink className="h-3 w-3" /> Source
          </a>
        )}
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.action} onClick={() => sendToPilot(buildActionCommand(a.action, signal), a.label)}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors">
              <Icon className="h-3 w-3" /> {a.label}
            </button>
          );
        })}
        {onIgnore && (
          <button onClick={() => onIgnore(signal.id)}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-neutral-400 hover:text-neutral-200">
            <EyeOff className="h-3 w-3" /> {reviewed ? "Reviewed" : "Mark reviewed"}
          </button>
        )}
      </div>
    </li>
  );
}
