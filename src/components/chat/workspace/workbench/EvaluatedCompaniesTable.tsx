import { AlertTriangle, ExternalLink } from 'lucide-react';
import {
  LIFECYCLE_LABEL, notableEvaluationRows, type EvaluationRow,
} from '@/lib/workbench/evaluationRows';

/**
 * Companies the run evaluated but did NOT qualify.
 *
 * Rendered as a separate, read-only table — not as rows in the lead table.
 * There are no checkboxes, no row actions and no selection state, because these
 * rows carry no `lead_candidate_id` and every action in the product requires
 * one. The separation is what lets the work be visible without any of it being
 * mistaken for a lead.
 */
export default function EvaluatedCompaniesTable({ rows }: { rows: EvaluationRow[] }) {
  if (rows.length === 0) return null;
  const notable = notableEvaluationRows(rows);
  const rest = rows.filter((r) => !notable.includes(r));

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
      <td className="py-2 pr-3 text-[12px] text-[#7D8590]">{r.prequalification_score || '—'}</td>
      <td className="py-2 pr-3">
        <div className="text-[11px] text-amber-300/90">{LIFECYCLE_LABEL[r.status]}</div>
        <div className="text-[11px] text-[#7D8590]">{r.explanation}</div>
      </td>
    </tr>
  );

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-300 mt-0.5 shrink-0" />
        <div className="text-[11px] text-[#C9D1D9]">
          These companies were evaluated but <strong>not qualified</strong>. They are shown so the
          run&rsquo;s work is visible — they do not count toward qualified companies or contact-ready
          leads, and no outreach or decision-maker search can run against them.
        </div>
      </div>

      {notable.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[#7D8590] mb-1">
            Shortlisted · {notable.length}
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#7D8590]">
                <th className="pb-1 pr-3 font-normal">Company</th>
                <th className="pb-1 pr-3 font-normal">Employees</th>
                <th className="pb-1 pr-3 font-normal">Strongest signal</th>
                <th className="pb-1 pr-3 font-normal">Score</th>
                <th className="pb-1 pr-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>{notable.map((r) => <Row key={r.company_key} r={r} />)}</tbody>
          </table>
        </div>
      )}

      {rest.length > 0 && (
        <details>
          <summary className="text-[11px] uppercase tracking-wider text-[#7D8590] cursor-pointer hover:text-[#C9D1D9] select-none">
            Excluded before any paid lookup · {rest.length}
          </summary>
          <table className="w-full text-left mt-1">
            <tbody>{rest.map((r) => <Row key={r.company_key} r={r} />)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}
