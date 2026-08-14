import { AlertTriangle, Clock, ExternalLink, HelpCircle, MinusCircle } from 'lucide-react';
import {
  LIFECYCLE_LABEL, notQualifiedRows, resumableRows, notInvestigatedRows,
  type EvaluationRow,
} from '@/lib/workbench/evaluationRows';

/**
 * Companies the run worked on and did NOT deliver as leads.
 *
 * Rendered as a separate, read-only table — not as rows in the lead table.
 * There are no checkboxes, no row actions and no selection state, because these
 * rows carry no `lead_candidate_id` and every action in the product requires
 * one. The separation is what lets the work be visible without any of it being
 * mistaken for a lead.
 *
 * ── AND THE HEADING IS NOT "NOT QUALIFIED" ──────────────────────────────────
 *
 * It used to be, for every row, under one banner reading "These companies were
 * evaluated but not qualified". Most of them were not. A company the
 * investigation budget never reached, one the deadline stopped mid-run, and one
 * the evaluator explicitly failed are three different outcomes, and only the
 * last is a rejection. The backend has distinguished them all along; this table
 * was the place the distinction was thrown away, one sentence before the user
 * read it.
 *
 * Each group is now captioned for what actually happened, and `decided` — not
 * mere presence in this table — is what authorises the word "not qualified".
 */
export default function EvaluatedCompaniesTable({ rows }: { rows: EvaluationRow[] }) {
  if (rows.length === 0) return null;

  const rejected = notQualifiedRows(rows);
  const resumable = resumableRows(rows);
  const uninvestigated = notInvestigatedRows(rows);
  // WHATEVER IS LEFT — in progress, or from a build that predates these fields.
  // Captioned neutrally, because an unrecognised row is not a rejection.
  const claimed = new Set([...rejected, ...resumable, ...uninvestigated]);
  const rest = rows.filter((r) => !claimed.has(r));

  const Row = ({ r }: { r: EvaluationRow }) => (
    <tr className="border-t border-white/[0.05] align-top">
      <td className="py-2 pr-3">
        <div className="text-[12px] text-[#C9D1D9]">{r.company_name}</div>
        {r.domain && <div className="text-[11px] text-[#7D8590]">{r.domain}</div>}
      </td>
      <td className="py-2 pr-3 text-[12px] text-[#7D8590]">{r.employee_count ?? '—'}</td>
      <td className="py-2 pr-3">
        {r.strongest_signal
          ? (
            <div className="text-[12px] text-[#C9D1D9]">
              {r.supporting_job_url
                ? (
                  <a href={r.supporting_job_url} target="_blank" rel="noreferrer"
                     className="hover:underline inline-flex items-center gap-1">
                    {r.strongest_signal}<ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                )
                : r.strongest_signal}
              {r.signal_tier && (
                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-300/90">
                  Tier {r.signal_tier}
                </span>
              )}
            </div>
          )
          : <span className="text-[12px] text-[#7D8590]">—</span>}
      </td>
      <td className="py-2 pr-3">
        {r.triage_relevance
          ? (
            <div className="text-[11px] text-[#7D8590]">
              <span className={
                r.triage_relevance === 'relevant' ? 'text-emerald-300/90'
                : r.triage_relevance === 'uncertain' ? 'text-[#7D8590]'
                : 'text-[#7D8590]'
              }>
                {r.triage_relevance}
              </span>
              {r.triage_signal_strength !== null && ` · ${r.triage_signal_strength}`}
            </div>
          )
          : <span className="text-[11px] text-[#7D8590]">—</span>}
      </td>
      <td className="py-2 pr-3 text-[12px] text-[#7D8590]">{r.prequalification_score || '—'}</td>
      <td className="py-2 pr-3">
        <div className={`text-[11px] ${r.decided ? 'text-rose-300/90' : 'text-amber-300/90'}`}>
          {LIFECYCLE_LABEL[r.status]}
        </div>
        {/* THE MOST SPECIFIC TRUE SENTENCE AVAILABLE, in order: the evaluator's
            own reasoning, why it was never investigated, why enrichment
            produced nothing, then the generic lifecycle explanation. */}
        <div className="text-[11px] text-[#7D8590]">
          {r.mission_reasoning
            ?? r.shortlist_exclusion_explanation
            ?? (r.enrichment_state === 'provider_error' || r.enrichment_state === 'deferred'
              ? r.enrichment_explanation
              : r.explanation)}
        </div>
        {r.mission_failed_requirements.length > 0 && (
          <div className="text-[11px] text-[#7D8590] mt-0.5">
            {r.mission_failed_requirements.slice(0, 2).map((f) => (
              <div key={f}>· {f}</div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );

  const Head = () => (
    <thead>
      <tr className="text-[10px] uppercase tracking-wider text-[#7D8590]">
        <th className="pb-1 pr-3 font-normal">Company</th>
        <th className="pb-1 pr-3 font-normal">Employees</th>
        <th className="pb-1 pr-3 font-normal">Strongest signal</th>
        <th className="pb-1 pr-3 font-normal">Triage</th>
        <th className="pb-1 pr-3 font-normal">Score</th>
        <th className="pb-1 pr-3 font-normal">Outcome</th>
      </tr>
    </thead>
  );

  const Section = (
    { title, note, rows: sectionRows, open }:
    { title: string; note: string; rows: EvaluationRow[]; open: boolean },
  ) => {
    if (sectionRows.length === 0) return null;
    return (
      <details open={open}>
        <summary className="text-[11px] uppercase tracking-wider text-[#7D8590] cursor-pointer hover:text-[#C9D1D9] select-none">
          {title} · {sectionRows.length}
        </summary>
        <div className="text-[11px] text-[#7D8590] mt-1 mb-1">{note}</div>
        <table className="w-full text-left">
          <Head />
          <tbody>{sectionRows.map((r) => <Row key={r.company_key} r={r} />)}</tbody>
        </table>
      </details>
    );
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
        <AlertTriangle className="h-3.5 w-3.5 text-[#7D8590] mt-0.5 shrink-0" />
        <div className="text-[11px] text-[#C9D1D9]">
          Companies this run worked on that did not become leads. None of them count toward
          qualified companies or contact-ready leads, and no outreach or decision-maker search
          can run against them.{' '}
          <strong>Only the &ldquo;Not qualified&rdquo; group below was actually judged</strong> —
          the rest were stopped by the run, not by a decision about the company.
        </div>
      </div>

      {resumable.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-2">
          <Clock className="h-3.5 w-3.5 text-amber-300 mt-0.5 shrink-0" />
          <div className="text-[11px] text-[#C9D1D9]">
            {resumable.length} {resumable.length === 1 ? 'company' : 'companies'} still
            {' '}<strong>unfinished</strong>. The run stopped before reaching a decision on
            {' '}{resumable.length === 1 ? 'it' : 'them'} — resuming will continue from where it
            left off. {resumable.length === 1 ? 'It has' : 'They have'} not been rejected.
          </div>
        </div>
      )}

      <Section
        title="Unfinished — resume to continue"
        note="The run ran out of time, or a provider call failed. No decision was made about these companies."
        rows={resumable}
        open
      />

      <Section
        title="Not qualified"
        note="Evaluated against the mission with the evidence collected, and judged not to meet it."
        rows={rejected}
        open
      />

      <Section
        title="Not investigated"
        note="Excluded before any paid lookup — the investigation budget ran out, or triage read them as outside the mission. Nothing was spent on these."
        rows={uninvestigated}
        open={false}
      />

      <Section
        title="Other"
        note="Discovered or in progress when the run ended."
        rows={rest}
        open={false}
      />

      <div className="flex items-center gap-3 text-[10px] text-[#7D8590]">
        <span className="inline-flex items-center gap-1">
          <MinusCircle className="h-3 w-3" /> {rejected.length} judged
        </span>
        <span className="inline-flex items-center gap-1">
          <HelpCircle className="h-3 w-3" /> {rows.length - rejected.length} not judged
        </span>
      </div>
    </div>
  );
}
