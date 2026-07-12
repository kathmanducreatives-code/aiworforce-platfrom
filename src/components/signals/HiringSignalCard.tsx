// HiringSignalCard — presents an enriched hiring signal honestly: "{Company} is
// hiring a {Role}." leads, then "This matters because…", role-family badge,
// location/date, evidence link and the canonical decision. Draft outreach only
// appears when the backend gate allows it (verified contact-grade + decision maker).
import { Building2, ExternalLink, MapPin, CalendarDays } from "lucide-react";
import { hiringCardVM, DECISION_LABEL, type RawSignal } from "@/lib/radarCardPresenter";

const DECISION_STYLE: Record<string, string> = {
  contact: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  watch: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  needs_review: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  skip: "border-white/10 bg-white/[0.03] text-neutral-400",
};
const FAMILY_STYLE: Record<string, string> = {
  exact: "border-emerald-500/30 text-emerald-300",
  adjacent: "border-sky-500/30 text-sky-300",
  unrelated: "border-white/10 text-neutral-400",
};

export default function HiringSignalCard({ signal }: { signal: RawSignal }) {
  const vm = hiringCardVM(signal);
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Exact role is never buried — it leads the card. */}
          <p className="text-[15px] font-semibold text-foreground">
            {(vm.company ?? "A company")} is hiring a {vm.role ?? "role"}.
          </p>
          {vm.why_it_matters && <p className="text-[13px] text-muted-foreground mt-1">{vm.why_it_matters}</p>}
        </div>
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border ${DECISION_STYLE[vm.decision] ?? DECISION_STYLE.needs_review}`}>
          {DECISION_LABEL[vm.decision]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-muted-foreground">
        {vm.role_family && <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${FAMILY_STYLE[vm.role_family] ?? FAMILY_STYLE.unrelated}`}>{vm.role_family} role</span>}
        {vm.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{vm.company}</span>}
        {vm.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{vm.location}</span>}
        {vm.posted_date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{vm.posted_date}</span>}
      </div>

      <div className="flex items-center gap-2 mt-3">
        {vm.evidence_url ? (
          <a href={vm.evidence_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> Job evidence
          </a>
        ) : (
          <span className="text-[12px] text-amber-300">Verify source — no job URL yet</span>
        )}
        {vm.can_draft_outreach ? (
          <button className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-md border border-border bg-background/50 hover:bg-muted/40">Draft outreach</button>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground">Outreach available after verification</span>
        )}
      </div>
    </div>
  );
}
