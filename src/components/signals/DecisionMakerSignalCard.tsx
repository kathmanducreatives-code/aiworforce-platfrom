// Decision-maker card. A person is shown as a decision maker ONLY in the context
// of a verified company signal; a standalone/legacy person row is clearly marked
// and never treated as a verified market signal.
import { type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, EvidenceLink } from "./radarCardBits";
import { AlertCircle } from "lucide-react";

function s(v: unknown): string | null { const t = typeof v === "string" ? v.trim() : ""; return t || null; }

export default function DecisionMakerSignalCard({ signal }: { signal: RawSignal }) {
  const raw = signal.raw ?? {};
  const details = (raw["source_details"] ?? {}) as Record<string, unknown>;
  const name = s(details["name"]) ?? s(raw["contact_name"]) ?? s(signal.title);
  const role = s(details["role"]) ?? s(raw["role_title"]);
  const company = s(details["company"]) ?? s(raw["account_name"]);
  const attachedTo = s(raw["attached_to"]);
  const standalone = !!raw["is_person_only"] || !!raw["excluded_from_verified"] || !attachedTo;
  const decision = (["contact", "watch", "needs_review", "skip"].includes(String(raw["canonical_decision"])) ? String(raw["canonical_decision"]) : "needs_review") as "contact" | "watch" | "needs_review" | "skip";

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">{name ?? "Person"}</p>
          <p className="text-[13px] text-muted-foreground mt-0.5">{[role, company].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <DecisionBadge decision={decision} />
      </div>
      {standalone ? (
        <div className="flex items-center gap-1.5 mt-2 text-[12px] text-amber-300">
          <AlertCircle className="h-3.5 w-3.5" /> Legacy person row — not a verified signal until attached to a company event.
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground mt-2">Attached to a verified {attachedTo} signal.</p>
      )}
      <div className="mt-2"><EvidenceLink url={s(details["profile_url"])} label="Open profile" /></div>
    </div>
  );
}
