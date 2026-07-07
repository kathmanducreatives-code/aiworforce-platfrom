// Right-side signal detail drawer. Evidence-first: shows why-it-matters, why-now,
// ICP fit, source proof, missing evidence, risk flags and the recommended next
// action — all from real signal data with honest fallbacks. Actions are
// approval-gated via SignalActionBar.
import { useEffect } from "react";
import { X, ExternalLink, Building2, Briefcase, Users, Calendar, ShieldCheck, ShieldAlert } from "lucide-react";
import type { FeedSignal } from "@/lib/signalFeedModel";
import type { ReviewStatus } from "@/lib/signalReviewModel";
import { evidenceState, missingEvidence, confidenceLabel } from "@/lib/signalPresenter";
import { signalTypeLabel } from "@/lib/radarBrief";
import SignalActionBar, { type SignalActionHandlers } from "./SignalActionBar";

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

export default function SignalDetailDrawer({
  signal,
  reviewStatus,
  handlers,
  onClose,
}: {
  signal: FeedSignal | null;
  reviewStatus?: ReviewStatus | null;
  handlers: SignalActionHandlers;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (signal) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signal, onClose]);

  if (!signal) return null;

  const raw = (signal.raw ?? {}) as Record<string, unknown>;
  const details = (raw.source_details && typeof raw.source_details === "object" ? raw.source_details : {}) as Record<string, unknown>;
  const company = signal.account_name ?? s(details.company);
  const verification = s(raw.verification_status) ?? signal.quality;
  const ev = evidenceState({ sourceUrl: signal.source_url, verificationStatus: verification, company });
  const conf = confidenceLabel(s(raw.confidence_label));
  const whyMatters = signal.why_text ?? s(raw.why_it_matters);
  const brainRelevance = s(raw.company_brain_relevance);
  const recommended = s(raw.recommended_action) ?? signal.next_action;
  const missing = missingEvidence({ sourceUrl: signal.source_url, verificationStatus: verification, company });

  const detailRows: { icon: React.ReactNode; label: string; value: string | null; href?: string | null }[] = [
    { icon: <Building2 className="h-3.5 w-3.5" />, label: "Company", value: company },
    { icon: <Briefcase className="h-3.5 w-3.5" />, label: "Role / job", value: s(details.job_title) ?? signal.role_title, href: s(details.job_url) },
    { icon: <ExternalLink className="h-3.5 w-3.5" />, label: "Company site", value: s(details.company_website), href: s(details.company_website) },
    { icon: <Users className="h-3.5 w-3.5" />, label: "Employees", value: s(details.employee_count) },
    { icon: <Calendar className="h-3.5 w-3.5" />, label: "Posted", value: s(details.posted_date) },
    { icon: <ExternalLink className="h-3.5 w-3.5" />, label: "Funding", value: [s(details.funding_amount), s(details.round)].filter(Boolean).join(" · ") || null },
    { icon: <ExternalLink className="h-3.5 w-3.5" />, label: "Funding source", value: s(details.funding_source_url), href: s(details.funding_source_url) },
  ].filter((r) => r.value);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-[#0d1117] border-l border-white/[0.08] shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-white/[0.06] px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-neutral-300">{signalTypeLabel(signal.signal_type)}</span>
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${ev.needsVerification ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
                {ev.needsVerification ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />} {ev.label}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-neutral-400">{conf.label}</span>
            </div>
            <h2 className="text-[17px] font-semibold text-[#F0F6FC] leading-snug">{signal.title}</h2>
            {company && <div className="text-[13px] text-neutral-400 mt-0.5">{company}</div>}
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-5 text-[#C9D1D9]">
          <Section title="Why this matters">
            <p className="text-[14px] leading-relaxed text-neutral-200">{whyMatters ?? <span className="text-neutral-500 italic">No reason saved — verify before acting.</span>}</p>
          </Section>

          {brainRelevance && (
            <Section title="ICP fit">
              <p className="text-[14px] leading-relaxed text-neutral-300">{brainRelevance}</p>
              {signal.matched_icp.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {signal.matched_icp.slice(0, 6).map((m) => (
                    <span key={m} className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300/90">{m}</span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {detailRows.length > 0 && (
            <Section title="Context & evidence">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] divide-y divide-white/[0.04]">
                {detailRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{r.icon}{r.label}</span>
                    {r.href ? (
                      <a href={r.href} target="_blank" rel="noreferrer" className="text-[12px] text-sky-300 hover:underline truncate max-w-[260px] inline-flex items-center gap-1">
                        {r.value} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-[12px] text-neutral-200 truncate max-w-[260px]">{r.value}</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Source proof">
            {signal.source_url ? (
              <a href={signal.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-sky-300 hover:underline break-all">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {signal.source_url}
              </a>
            ) : (
              <p className="text-[13px] text-amber-300/80">No source URL — treat as an idea, not confirmed proof.</p>
            )}
          </Section>

          {missing.length > 0 && (
            <Section title="Missing evidence">
              <ul className="space-y-1">
                {missing.map((m) => (
                  <li key={m} className="text-[13px] text-amber-200/85 inline-flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {m}</li>
                ))}
              </ul>
            </Section>
          )}

          {recommended && (
            <Section title="Recommended next action">
              <p className="text-[14px] text-emerald-200/90">{recommended}</p>
            </Section>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#0d1117]/95 backdrop-blur border-t border-white/[0.06] px-5 py-3">
          <SignalActionBar reviewStatus={reviewStatus} handlers={handlers} />
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}
