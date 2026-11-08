import type { ReactNode } from 'react';
import { ArrowRight, History, Loader2, RefreshCw } from 'lucide-react';
import {
  briefFreshness, CONFIDENCE_LABEL,
  type BriefEntry, type Confidence, type EvidenceRef, type ExecutiveBrief, type StoredBrief,
} from '@/lib/orion/executiveBrief';

/**
 * ORION — EXECUTIVE INTELLIGENCE, the dashboard view.
 *
 * Presentational only: everything it shows comes from a stored brief
 * (`saved_outputs`, type `executive_brief`) passed in by OrionBriefPanel.
 * Every priority, opportunity, alert and action links to the record it was
 * built from via `onNavigate(route)` — in-app routes only (parseExecutiveBrief
 * drops anything else).
 */
export interface OrionBriefViewProps {
  history: StoredBrief[];
  selectedId: string | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
  now?: Date;
  portrait?: ReactNode;
  onGenerate: () => void;
  onSelect: (id: string) => void;
  onNavigate: (route: string) => void;
}

const CONF_CLASS: Record<Confidence, string> = {
  high: 'orion-conf orion-conf--high',
  medium: 'orion-conf orion-conf--medium',
  low: 'orion-conf orion-conf--low',
};

function Evidence({ refs, onNavigate }: { refs: EvidenceRef[]; onNavigate: (r: string) => void }) {
  if (!refs.length) return null;
  return (
    <span className="orion-evidence">
      <span className="orion-evidence__label">Evidence</span>
      {refs.slice(0, 3).map((e) => (
        <button key={`${e.table}:${e.id}`} type="button" className="orion-evidence__link"
          title={`${e.table} · ${e.id}`} onClick={() => onNavigate(e.route)}>
          {e.title}
        </button>
      ))}
    </span>
  );
}

function Section({ title, items, empty, onNavigate }: {
  title: string; items: BriefEntry[]; empty: string; onNavigate: (r: string) => void;
}) {
  return (
    <div className="orion-section" aria-label={title}>
      <h3 className="orion-section__title">{title}</h3>
      {items.length === 0 ? <p className="orion-muted">{empty}</p> : (
        <ul className="orion-list">
          {items.slice(0, 4).map((e) => (
            <li key={e.id}>
              <button type="button" className="orion-row" onClick={() => onNavigate(e.evidence[0].route)}>
                <span className="min-w-0 flex-1">
                  <span className="orion-row__title">{e.title}</span>
                  {e.detail && <span className="orion-row__meta">{e.detail}</span>}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BriefBody({ brief, onNavigate }: { brief: ExecutiveBrief; onNavigate: (r: string) => void }) {
  return (
    <>
      <p className="orion-summary">{brief.summary}</p>

      <ol className="orion-priorities" aria-label="Top priorities">
        {brief.priorities.length === 0 && <li className="orion-muted">Nothing needs you right now.</li>}
        {brief.priorities.map((p) => (
          <li key={p.id} className="orion-priority">
            <span className="orion-priority__rank" aria-hidden>{p.rank}</span>
            <div className="min-w-0 flex-1">
              <div className="orion-priority__head">
                <span className="orion-priority__title">{p.title}</span>
                <span className={CONF_CLASS[p.confidence]}>{CONFIDENCE_LABEL[p.confidence]}</span>
              </div>
              <p className="orion-priority__why">{p.why}</p>
              <div className="orion-priority__foot">
                <button type="button" className="ag-btn ag-btn-primary orion-action" onClick={() => onNavigate(p.action.route)}>
                  {p.action.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
                <Evidence refs={p.evidence} onNavigate={onNavigate} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="orion-grid">
        <Section title="Opportunities" items={brief.opportunities} empty="No qualified leads this week." onNavigate={onNavigate} />
        <Section title="Market alerts" items={brief.market_changes} empty="No new market signals this week." onNavigate={onNavigate} />
        <Section title="Pending decisions" items={brief.pending_decisions} empty="Nothing waiting on you." onNavigate={onNavigate} />
      </div>

      {brief.recommended_actions.length > 0 && (
        <div className="orion-section" aria-label="Recommended next actions">
          <h3 className="orion-section__title">Recommended next actions</h3>
          <ol className="orion-actions">
            {brief.recommended_actions.map((r) => (
              <li key={r.id}>
                <button type="button" className="orion-row" onClick={() => onNavigate(r.route)}>
                  <span className="min-w-0 flex-1">
                    <span className="orion-row__title">{r.action}</span>
                    <span className="orion-row__meta">{r.why}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {brief.confidence.notes.length > 0 && (
        <ul className="orion-notes" aria-label="Confidence notes">
          {brief.confidence.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </>
  );
}

export default function OrionBriefView({
  history, selectedId, loading, generating, error, now, portrait, onGenerate, onSelect, onNavigate,
}: OrionBriefViewProps) {
  const selected = history.find((h) => h.id === selectedId) ?? history[0] ?? null;
  const fresh = selected ? briefFreshness(selected.brief.generated_at, now) : null;
  const isLatest = !!selected && selected.id === history[0]?.id;

  return (
    <section className="team-panel orion-brief" aria-label="Orion executive brief">
      <div className="team-panel-header">
        <h2 className="flex items-center gap-2">
          {portrait}
          Orion · Executive brief
        </h2>
        <div className="flex items-center gap-2">
          {history.length > 1 && (
            <label className="orion-history">
              <History className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Briefing history</span>
              <select value={selected?.id ?? ''} onChange={(e) => onSelect(e.target.value)} aria-label="Briefing history">
                {history.map((h, i) => (
                  <option key={h.id} value={h.id}>
                    {i === 0 ? 'Latest · ' : ''}{new Date(h.brief.generated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={onGenerate} disabled={generating}
            className="ag-btn ag-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px]">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            {generating ? 'Briefing…' : selected ? 'New brief' : 'Brief me'}
          </button>
        </div>
      </div>

      {error && <p className="orion-error" role="alert">{error}</p>}

      {loading ? (
        <p className="orion-muted">Loading your latest brief…</p>
      ) : !selected ? (
        <div className="orion-empty">
          <p className="orion-empty__title">No executive brief yet</p>
          <p className="orion-muted">
            Orion reads your signals, leads, drafts, approvals and Company Brain, then tells you the three things that matter most — with the records behind each one.
          </p>
        </div>
      ) : (
        <>
          <p className={fresh?.current && isLatest ? 'orion-stamp' : 'orion-stamp orion-stamp--historical'}>
            {isLatest ? '' : 'Historical brief · '}{fresh?.label}
            {selected.brief.brain.used ? ` · Tailored to ${selected.brief.brain.company ?? 'your Company Brain'}` : ' · Company Brain not used'}
            {` · ${CONFIDENCE_LABEL[selected.brief.confidence.overall]}`}
          </p>
          <BriefBody brief={selected.brief} onNavigate={onNavigate} />
        </>
      )}
    </section>
  );
}
