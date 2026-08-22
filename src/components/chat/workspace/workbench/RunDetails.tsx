// EVERYTHING TRUE BUT NOT THE POINT, ONE CLICK AWAY.
//
// ── WHAT MOVED IN HERE ──────────────────────────────────────────────────────
//
// PortfolioSummary (11 cells), WorkflowProgressStrip (7 stage lines), and the
// evaluated-but-unqualified companies table. All three used to render ABOVE the
// leads, and the third took `max-h-[45%]` of what was left — so in an 800px
// panel the qualified leads, the thing the user came for, got roughly 180px.
//
// None of it is deleted. Stage counts are how someone answers "why only three?",
// and the evaluated table is how they check the run did not silently skip
// companies. Both are DIAGNOSTIC: read once, when a number looks wrong. That is
// what a details section is for.
//
// ── AND THE DISAGREEMENT REPORT ─────────────────────────────────────────────
//
// New, and the reason this is not merely a tidy-up. Those three sections read
// three different persisted projections of the same run and nothing ever
// compared them, so "Qualified 3" could sit beside "Qualified companies 6" with
// no way to tell which was true. `buildRunSummary` picks one authority and
// records every dissent; this is where the dissent is shown. A conflict nobody
// can see is a conflict that survives.

import { useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { RunSummary, SummaryNumber } from '@/lib/workbench/runSummary';
import type { PortfolioView } from '@/lib/workbench/portfolioView';
import type { WorkbenchProgress } from '@/lib/workbench/workbenchProgress';
import type { EvaluationRow } from '@/lib/workbench/evaluationRows';
import { progressLines, exclusionSummary } from '@/lib/workbench/workbenchProgress';
import EvaluatedCompaniesTable from './EvaluatedCompaniesTable';

const SOURCE_LABEL: Record<string, string> = {
  engine_quota: 'run contract',
  portfolio: 'ranked portfolio',
  progress: 'stage progress',
  rows: 'result rows',
  none: 'not recorded',
};

interface Props {
  summary: RunSummary;
  portfolio: PortfolioView | null;
  progress: WorkbenchProgress | null;
  evaluationRows: EvaluationRow[];
}

export default function RunDetails({ summary, portfolio, progress, evaluationRows }: Props) {
  const [open, setOpen] = useState(false);

  return (
    // `shrink-0` so the collapsed row (~44px) never squeezes the table, and a
    // bounded, self-scrolling body when open. Expanding costs the table height
    // — which is correct HERE and was the defect before: the user asked to see
    // this. What must never happen again is these sections taking the leads'
    // space unbidden.
    <div className="border-t border-white/[0.06] shrink-0 flex flex-col min-h-0 max-h-[60%]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-6 py-3 text-[12.5px] text-[#8b949e] hover:text-[#C9D1D9] transition-colors shrink-0"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        Run details
        {/* THE ONLY THING THAT PULLS ATTENTION FROM THE COLLAPSED STATE. A
            number two records disagree about is worth interrupting for. */}
        {summary.hasDisagreement && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90">
            <AlertTriangle className="h-3 w-3" />
            counts disagree
          </span>
        )}
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-6 overflow-auto min-h-0">
          {summary.hasDisagreement && (
            <Section title="Counts that disagree">
              <p className="text-[12.5px] text-[#8b949e] leading-relaxed mb-3">
                Different records of this run report different totals. The
                headline uses the {SOURCE_LABEL[summary.qualified.source]}.
              </p>
              <Disagreement label="Qualified" n={summary.qualified} />
              <Disagreement label="Reviewed" n={summary.reviewed} />
              <Disagreement label="Pending" n={summary.pending} />
            </Section>
          )}

          {progress && (
            <Section title="How the run progressed">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
                {progressLines(progress).map((l) => (
                  <div key={l.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[12.5px] text-[#8b949e]">{l.label}</dt>
                    {/* A stage that has not run shows "—", never "0": "we have
                        not looked" and "we found none" are different facts. */}
                    <dd className={`text-[13px] tabular-nums ${l.reached ? 'text-[#C9D1D9]' : 'text-[#4a5058]'}`}>
                      {l.reached ? l.value : '—'}
                    </dd>
                  </div>
                ))}
              </dl>
              {exclusionSummary(progress).length > 0 && (
                <p className="mt-3 text-[12px] text-[#6e7681]">
                  Skipped before any paid lookup: {exclusionSummary(progress).join(', ')}.
                </p>
              )}
            </Section>
          )}

          {portfolio && (
            <Section title="How companies were graded">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
                <Cell label="Matched your criteria" v={portfolio.counts.qualified} />
                <Cell label="Needs a closer look" v={portfolio.counts.review} />
                <Cell label="Kept for later" v={portfolio.counts.watch} />
                <Cell label="Strong match" v={portfolio.counts.tier_a} />
                <Cell label="Good match" v={portfolio.counts.tier_b} />
                <Cell label="Possible match" v={portfolio.counts.tier_c} />
              </dl>
            </Section>
          )}

          {evaluationRows.length > 0 && (
            <Section title={`Companies that didn't make the list (${evaluationRows.length})`}>
              <p className="text-[12.5px] text-[#8b949e] leading-relaxed mb-3">
                Reviewed and set aside. There is no action to take on these — they
                are here so you can check nothing was missed.
              </p>
              <div className="max-h-[420px] overflow-auto rounded-lg border border-white/[0.06]">
                <EvaluatedCompaniesTable rows={evaluationRows} />
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-[0.08em] text-[#6e7681] mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Cell({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-[#8b949e]">{label}</span>
      <span className="text-[13px] tabular-nums text-[#C9D1D9]">{v}</span>
    </div>
  );
}

function Disagreement({ label, n }: { label: string; n: SummaryNumber }) {
  if (n.disagreements.length === 0) return null;
  return (
    <div className="text-[12.5px] text-[#C9D1D9] py-1">
      <span className="text-[#8b949e]">{label}:</span>{' '}
      <span className="tabular-nums">{n.value}</span>{' '}
      <span className="text-[#6e7681]">({SOURCE_LABEL[n.source]})</span>
      {n.disagreements.map((d) => (
        <span key={d.source} className="text-[#6e7681]">
          {' · '}
          <span className="tabular-nums text-amber-300/80">{d.value}</span>{' '}
          ({SOURCE_LABEL[d.source]})
        </span>
      ))}
    </div>
  );
}
