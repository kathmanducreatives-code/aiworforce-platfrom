import { useState } from 'react';
import { ChevronDown, ChevronRight, Filter } from 'lucide-react';
import { gateLabel, type QualificationInsightsView } from '@/lib/qualifiedLead/insights';

/**
 * WORKBENCH INSIGHTS — where evaluated-but-rejected companies become visible.
 *
 * The backend records one diagnostic per company the Company Brain evaluated,
 * including the ones its filter drops. Until this panel existed nothing rendered
 * them, so a run could evaluate twenty-five companies, qualify none, and show an
 * empty Workbench with no explanation.
 *
 * DELIBERATELY NOT AN OPPORTUNITY LIST. Everything here is quota-ineligible by
 * construction, and the panel is visually and structurally separate from the
 * lead table so a rejected company can never read as a qualified one.
 */
interface Props {
  insights: QualificationInsightsView;
  /** Truthful in-flight state; null once all valid work has stopped. */
  processing?: string | null;
  /** The current funnel constriction, when the backend named one. */
  bottleneck?: string | null;
}

export default function QualificationInsightsPanel({ insights, processing = null, bottleneck = null }: Props) {
  const [open, setOpen] = useState(false);

  // Nothing evaluated yet and nothing in flight: say so plainly rather than
  // rendering an empty shell.
  if (insights.companies_evaluated === 0 && !processing) {
    return (
      <div
        data-testid="insights-empty"
        className="mx-3 mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[12px] text-[#9aa4af]"
      >
        No companies have been evaluated yet.
      </div>
    );
  }

  return (
    <div data-testid="qualification-insights" className="mx-3 mt-3 rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-3 p-2.5">
        <div className="h-7 w-7 rounded-md border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0">
          <Filter className="h-3.5 w-3.5 text-[#9aa4af]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[#9aa4af]">Qualification insights</div>
          <div data-testid="insights-counts" className="text-[12px] text-[#c7cdd4] mt-0.5">
            <span data-testid="companies-evaluated">{insights.companies_evaluated} evaluated</span>
            {' · '}
            <span data-testid="companies-qualified">{insights.companies_qualified} qualified</span>
            {' · '}
            <span data-testid="companies-rejected">{insights.companies_rejected} rejected</span>
            {insights.companies_pending > 0 && <> · <span>{insights.companies_pending} pending evidence</span></>}
          </div>
          {processing && (
            <div data-testid="insights-processing" className="text-[11.5px] text-emerald-300/80 mt-1">
              {processing}
            </div>
          )}
          {insights.rejection_summary && (
            <div data-testid="rejection-summary" className="text-[11.5px] text-[#9aa4af] mt-1 leading-relaxed">
              {insights.rejection_summary}
            </div>
          )}
          {bottleneck && (
            <div data-testid="insights-bottleneck" className="text-[11px] text-[#7f8a95] mt-1">
              Bottleneck: {bottleneck.replace(/_/g, ' ')}
            </div>
          )}
        </div>
        {insights.rejected.length > 0 && (
          <button
            data-testid="insights-toggle"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-md border border-white/10 text-[#c7cdd4] hover:bg-white/[0.04] transition-colors"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {open ? 'Hide' : 'Show'} rejected
          </button>
        )}
      </div>

      {insights.failed_gate_counts.length > 0 && (
        <div data-testid="failed-gate-summary" className="px-2.5 pb-2.5 flex flex-wrap gap-1.5">
          {insights.failed_gate_counts.map((g) => (
            <span
              key={g.gate}
              data-testid={`gate-chip-${g.gate}`}
              className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/[0.08] text-amber-200/90"
            >
              {gateLabel(g.gate)} · {g.count}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div data-testid="rejected-companies" className="border-t border-white/10 max-h-[280px] overflow-y-auto">
          {insights.rejected.map((c) => (
            <div
              key={c.company_key}
              data-testid={`rejected-company-${c.company_key}`}
              className="px-2.5 py-2 border-b border-white/[0.06] last:border-b-0"
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[12px] text-[#e6e9ec] truncate">{c.company_name || c.company_key}</span>
                {c.company_domain && <span className="text-[11px] text-[#7f8a95] truncate">{c.company_domain}</span>}
                <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-amber-300/80">
                  {c.company_brain_status === 'fail' ? 'Rejected' : c.company_brain_status.replace(/_/g, ' ')}
                </span>
              </div>
              {c.hiring_signal_title && (
                <div className="text-[11.5px] text-[#9aa4af] mt-0.5 truncate">
                  {c.hiring_signal_title}
                  {c.hiring_signal_date && <span className="text-[#7f8a95]"> · {c.hiring_signal_date}</span>}
                </div>
              )}
              {c.failed_gates.length > 0 && (
                <div data-testid={`gates-${c.company_key}`} className="text-[11px] text-amber-200/80 mt-1">
                  {c.failed_gates.map(gateLabel).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
