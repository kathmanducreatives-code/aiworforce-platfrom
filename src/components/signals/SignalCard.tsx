import { ExternalLink, MessageSquare, Send, Search, FileText, EyeOff, Check, Bookmark, Zap, Building2, User, MapPin, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { buildActionCommand, signalTypeLabel, sourceHost, type SignalAction } from "@/lib/signalFeedModel";
import { nextStatusAfterDraft, type ReviewStatus, type ReviewedSignal } from "@/lib/signalReviewModel";

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

// Card opacity by review status: new normal, reviewed dim, ignored dimmer.
const STATUS_OPACITY: Record<ReviewStatus, string> = {
  new: "",
  saved: "",
  actioned: "",
  reviewed: "opacity-70",
  ignored: "opacity-40",
};

type ActionDef = { action: SignalAction; label: string; icon: any; drafts: boolean };

function actionsForSignal(s: ReviewedSignal): ActionDef[] {
  switch (s.signal_type) {
    case "competitor_engagement":
    case "linkedin_engagement":
      return [
        { action: "draft_comment", label: "Draft comment", icon: MessageSquare, drafts: true },
        { action: "draft_dm", label: "Draft DM", icon: Send, drafts: true },
        { action: "enrich", label: "Enrich", icon: Search, drafts: false },
      ];
    case "hiring_signal":
      return [
        { action: "enrich", label: "Enrich company", icon: Search, drafts: false },
        { action: "create_outreach", label: "Draft outreach", icon: FileText, drafts: true },
      ];
    default:
      return [
        { action: "enrich", label: "Enrich", icon: Search, drafts: false },
        { action: "create_outreach", label: "Draft outreach", icon: FileText, drafts: true },
      ];
  }
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-white/[0.04] last:border-0">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-[11px] text-neutral-200 text-right truncate max-w-[140px]" title={typeof value === "string" ? value : undefined}>{value}</span>
    </div>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

const STATUS_BADGE: Partial<Record<ReviewStatus, { label: string; className: string; icon: any }>> = {
  saved: { label: "Saved", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: Bookmark },
  reviewed: { label: "Reviewed", className: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: Check },
  ignored: { label: "Ignored", className: "border-white/10 bg-white/[0.03] text-neutral-500", icon: EyeOff },
  actioned: { label: "Actioned", className: "border-violet-500/30 bg-violet-500/10 text-violet-300", icon: Zap },
};

export default function SignalCard({
  signal,
  selectable,
  selected,
  onToggleSelect,
  onSetReview,
  onDraftAction,
}: {
  signal: ReviewedSignal;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onSetReview?: (id: string, status: ReviewStatus) => void;
  onDraftAction?: (id: string) => void;
}) {
  const actions = actionsForSignal(signal);
  const host = sourceHost(signal.source_url);
  const created = formatDate(signal.created_at);
  const isCompetitor = signal.signal_type === "competitor_engagement";
  const status = signal.review_status;
  const statusBadge = STATUS_BADGE[status];

  // Clicking the active status toggles it back to `new`; otherwise sets it.
  const toggleStatus = (target: ReviewStatus) =>
    onSetReview?.(signal.id, status === target ? "new" : target);

  const runAction = (a: ActionDef) => {
    sendToPilot(buildActionCommand(a.action, signal), a.label);
    if (a.drafts) onDraftAction?.(signal.id);
  };

  const reviewBtn = (target: ReviewStatus, label: string, Icon: any, activeClass: string) => (
    <button onClick={() => toggleStatus(target)}
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
        status === target ? activeClass : "border-white/[0.08] bg-white/[0.02] text-neutral-400 hover:text-neutral-200"
      }`}>
      <Icon className="h-3 w-3" /> {label}
    </button>
  );

  return (
    <li className={`rounded-lg border bg-white/[0.02] px-3 py-2.5 transition-opacity ${STATUS_OPACITY[status]} ${selected ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "border-white/[0.06]"}`}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">

        {/* LEFT: main content */}
        <div className="min-w-0">
          {/* badges row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {selectable && (
              <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(signal.id)}
                aria-label="Select signal"
                className="mr-1 accent-emerald-500 h-3.5 w-3.5 cursor-pointer" />
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[signal.signal_type] ?? "border-white/15 bg-white/5 text-neutral-300"}`}>
              {signalTypeLabel(signal.signal_type)}
            </span>
            {signal.priority && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[signal.priority.toLowerCase()] ?? "border-white/15 bg-white/5 text-neutral-300"}`}>
                {signal.priority}
              </span>
            )}
            {statusBadge && (
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${statusBadge.className}`}>
                <statusBadge.icon className="h-3 w-3" /> {statusBadge.label}
              </span>
            )}
          </div>

          {/* title */}
          <div className="text-[13px] text-[#F0F6FC] font-medium leading-snug">{signal.title}</div>
          {signal.signal_label && signal.signal_label !== signal.title && (
            <div className="text-[11px] text-neutral-400 mt-0.5">{signal.signal_label}</div>
          )}

          {/* contact/account line */}
          {(signal.contact_name || signal.account_name || signal.role_title || signal.location) && (
            <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-neutral-300">
              {signal.contact_name && (
                <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-neutral-500" />{signal.contact_name}</span>
              )}
              {signal.account_name && (
                <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3 text-neutral-500" />{signal.account_name}</span>
              )}
              {signal.role_title && (
                <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3 text-neutral-500" />{signal.role_title}</span>
              )}
              {signal.location && (
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-neutral-500" />{signal.location}</span>
              )}
            </div>
          )}

          {/* description / snippet */}
          <div className="text-[12px] text-[#C9D1D9] mt-1.5 line-clamp-3 whitespace-pre-wrap">
            {signal.post_snippet || signal.description || (
              <span className="text-neutral-500 italic">No detailed reason saved yet.</span>
            )}
          </div>

          {/* reason / why it matters */}
          {signal.reason && signal.reason !== signal.description && (
            <div className="text-[11px] text-neutral-400 mt-1.5">
              <span className="text-neutral-500">Why it matters: </span>{signal.reason}
            </div>
          )}

          {/* competitor block */}
          {isCompetitor && signal.competitor_name && (
            <div className="mt-2 rounded-md border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-2 text-[11px] text-amber-100/90">
              <div className="font-medium text-amber-200">
                Competitor: {signal.competitor_name}
                {signal.competitor_category && <span className="text-amber-300/70"> · {signal.competitor_category}</span>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-amber-200/70">
                {signal.competitor_source && <span>Source: {signal.competitor_source}</span>}
                {signal.competitor_confidence != null && <span>Confidence: {Math.round(signal.competitor_confidence * 100)}%</span>}
                {signal.conversation_type && <span>Conversation: {signal.conversation_type.replace(/_/g, " ")}</span>}
              </div>
              {signal.matched_query && (
                <div className="mt-1 text-amber-200/60 truncate" title={signal.matched_query}>Matched query: "{signal.matched_query}"</div>
              )}
            </div>
          )}

          {/* discovery context */}
          {(signal.original_business_description || signal.original_website_url) && !isCompetitor && (
            <div className="text-[10px] text-neutral-500 mt-1.5 space-y-0.5">
              {signal.original_business_description && <div>your business: <span className="text-neutral-400">{signal.original_business_description}</span></div>}
              {signal.original_website_url && <div>from: <span className="text-neutral-400">{signal.original_website_url}</span></div>}
            </div>
          )}

          {/* actions */}
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            {signal.source_url && (
              <a href={signal.source_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-sky-300 hover:bg-sky-500/[0.06]">
                <ExternalLink className="h-3 w-3" /> Source
              </a>
            )}
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.action} onClick={() => runAction(a)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors">
                  <Icon className="h-3 w-3" /> {a.label}
                </button>
              );
            })}

            {/* review state controls */}
            {onSetReview && (
              <div className="inline-flex items-center gap-1.5 ml-auto">
                {reviewBtn("saved", "Save", Bookmark, "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")}
                {reviewBtn("reviewed", status === "reviewed" ? "Reviewed" : "Mark reviewed", Check, "border-sky-500/30 bg-sky-500/10 text-sky-300")}
                {reviewBtn("ignored", "Ignore", EyeOff, "border-white/15 bg-white/[0.04] text-neutral-300")}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: metadata rail */}
        <div className="md:border-l md:border-white/[0.05] md:pl-3">
          <div className="rounded-md border border-white/[0.06] bg-white/[0.015] p-2.5">
            <MetaRow label="Status" value={<span className="capitalize">{status}</span>} />
            {signal.priority && <MetaRow label="Priority" value={<span className="capitalize">{signal.priority}</span>} />}
            <MetaRow label="Type" value={signalTypeLabel(signal.signal_type)} />
            {(host || signal.source) && <MetaRow label="Source" value={host ?? signal.source ?? ""} />}
            {created && <MetaRow label="Created" value={<span title={signal.created_at ?? ""}>{created}</span>} />}
            {signal.fit_score != null && <MetaRow label="Fit score" value={`${Math.round(signal.fit_score)}`} />}
            {signal.competitor_confidence != null && <MetaRow label="Confidence" value={`${Math.round(signal.competitor_confidence * 100)}%`} />}
            {signal.competitor_name && <MetaRow label="Competitor" value={signal.competitor_category ? `${signal.competitor_name} · ${signal.competitor_category}` : signal.competitor_name} />}
            {signal.conversation_type && <MetaRow label="Conversation" value={signal.conversation_type.replace(/_/g, " ")} />}
            {signal.matched_query && <MetaRow label="Query" value={signal.matched_query} />}
          </div>
        </div>
      </div>
    </li>
  );
}
