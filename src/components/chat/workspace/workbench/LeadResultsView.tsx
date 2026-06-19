import { useMemo, useState, useCallback } from 'react';
import { useLeadResults, type LeadTableRow } from '@/hooks/useLeadResults';
import { dispatchResultAction, type LeadResultPanelAction } from '@/lib/chatActions';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import LeadTable from './leadTable/LeadTable';
import LockedCell from './leadTable/LockedCell';
import RecommendationBanner from './leadTable/RecommendationBanner';
import BulkActionToolbar from './leadTable/BulkActionToolbar';
import LeadDetailDrawer from './leadTable/LeadDetailDrawer';
import { estimateCredits, recommendNextAction, ACTION_LABEL } from './leadTable/credits';
import { rowsToCsv, downloadCsv } from './leadTable/csv';
import { Loader2, Filter } from 'lucide-react';

interface Props {
  meta: LeadResultsPanelMeta;
  conversationId: string | null;
}

export default function LeadResultsView({ meta, conversationId }: Props) {
  const { items, loading, error, refresh } = useLeadResults(meta.plan_id);
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [minFit, setMinFit] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerRow, setDrawerRow] = useState<LeadTableRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: LeadResultPanelAction; ids: string[]; credits: number } | null>(null);

  const filtered = useMemo(() => items.filter((r) => {
    if (onlyWithWebsite && !r.website) return false;
    if (minFit > 0 && (r.fit_score ?? 0) < minFit) return false;
    return true;
  }), [items, onlyWithWebsite, minFit]);

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected],
  );
  const targetRows = selectedRows.length > 0 ? selectedRows : filtered;

  const bulkCredits = useMemo<Record<LeadResultPanelAction, number>>(() => ({
    enrich: estimateCredits('enrich', selectedRows),
    enrich_and_draft: estimateCredits('enrich_and_draft', selectedRows),
    find_contacts: estimateCredits('find_contacts', selectedRows),
    research_company: estimateCredits('research_company', selectedRows),
    draft_outreach: estimateCredits('draft_outreach', selectedRows),
    rank: estimateCredits('rank', selectedRows),
    export_csv: 0,
    save_to_signal_feed: 0,
  }), [selectedRows]);

  const counts = useMemo(() => ({
    found: items.length,
    contactReady: items.filter((r) => r.contact_status !== 'needs_contact').length,
    needContact: items.filter((r) => r.contact_status === 'needs_contact').length,
    enrichable: items.filter((r) => !!r.website && r.enrichment_status !== 'enriched').length,
    draftReady: items.filter((r) => r.draft_status === 'drafted' || r.draft_status === 'approved').length,
  }), [items]);

  const recommendation = useMemo(() => meta.recommended_next_action
    ? {
        action: (meta.recommended_next_action.action as LeadResultPanelAction) ?? 'find_contacts',
        label: meta.recommended_next_action.label,
        reason: meta.recommended_next_action.reason,
        estimated_credits: meta.recommended_next_action.estimated_credits ?? 0,
      }
    : recommendNextAction(items),
  [items, meta.recommended_next_action]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelected((s) => {
      if (s.size === filtered.length) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  }, [filtered]);

  const runAction = useCallback((action: LeadResultPanelAction, rows: LeadTableRow[]) => {
    if (action === 'export_csv') {
      downloadCsv(`leads-${meta.plan_id.slice(0, 8)}.csv`, rowsToCsv(rows));
      return;
    }
    const credits = estimateCredits(action, rows);
    if (credits > 0) {
      setConfirmAction({ action, ids: rows.map((r) => r.id), credits });
      return;
    }
    dispatchResultAction({
      conversationId,
      planId: meta.plan_id,
      leadCandidateIds: rows.map((r) => r.id),
      action,
      estimatedCredits: credits,
    });
  }, [conversationId, meta.plan_id]);

  const onBulkAction = useCallback((a: LeadResultPanelAction) => runAction(a, targetRows), [runAction, targetRows]);
  const onUnlock = useCallback((a: LeadResultPanelAction, id: string) => {
    const row = items.find((r) => r.id === id);
    if (!row) return;
    runAction(a, [row]);
  }, [runAction, items]);

  const onRunRecommendation = useCallback(() => runAction(recommendation.action, items), [runAction, recommendation.action, items]);

  const confirmAndDispatch = useCallback(() => {
    if (!confirmAction) return;
    dispatchResultAction({
      conversationId,
      planId: meta.plan_id,
      leadCandidateIds: confirmAction.ids,
      action: confirmAction.action,
      estimatedCredits: confirmAction.credits,
      confirmed: true,
    });
    setConfirmAction(null);
  }, [confirmAction, conversationId, meta.plan_id]);

  return (
    <div className="h-full w-full min-w-0 flex flex-col bg-[#0a0d12] relative overflow-hidden">

      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-[#F0F6FC] flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {meta.title}
            </div>
            <div className="text-[11px] text-[#7D8590] mt-0.5">{meta.subtitle}</div>
          </div>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300 shrink-0">
            {meta.source_type.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Summary chips */}
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[10.5px]">
          <Chip label="Found" v={counts.found} tone="default" />
          <Chip label="Contact-ready" v={counts.contactReady} tone={counts.contactReady > 0 ? 'good' : 'muted'} />
          <Chip label="Needs contact" v={counts.needContact} tone={counts.needContact > 0 ? 'warn' : 'muted'} />
          <Chip label="Enrichable" v={counts.enrichable} tone={counts.enrichable > 0 ? 'good' : 'muted'} />
          <Chip label="Drafts" v={counts.draftReady} tone={counts.draftReady > 0 ? 'good' : 'muted'} />

          <div className="ml-auto flex items-center gap-1.5">
            <Filter className="h-3 w-3 text-[#7D8590]" />
            <button
              onClick={() => setOnlyWithWebsite((v) => !v)}
              className={`px-2 py-0.5 rounded border transition-colors ${onlyWithWebsite ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.02] text-[#9aa4af] hover:text-[#C9D1D9]'}`}
            >
              Has website
            </button>
            {[60, 75, 90].map((v) => (
              <button
                key={v}
                onClick={() => setMinFit(minFit === v ? 0 : v)}
                className={`px-2 py-0.5 rounded border transition-colors ${minFit === v ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.02] text-[#9aa4af] hover:text-[#C9D1D9]'}`}
              >
                Fit ≥ {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <RecommendationBanner rec={recommendation} onRun={onRunRecommendation} />
      <BulkActionToolbar
        selectedCount={selectedRows.length}
        onClear={() => setSelected(new Set())}
        onAction={onBulkAction}
        credits={bulkCredits}
      />

      {/* Body */}
      {loading && items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-[#7D8590]">
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading leads…
        </div>
      ) : error ? (
        <div className="m-3 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md p-2">
          {error} <button onClick={refresh} className="underline ml-2">Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-[#7D8590]">No leads match these filters.</div>
      ) : (
        <LeadTable
          rows={filtered}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onOpen={setDrawerRow}
          onUnlock={onUnlock}
        />
      )}

      {/* Footer note */}
      <div className="border-t border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur px-3 py-1.5 text-[10px] text-[#7D8590] flex items-center justify-between">
        <span>{filtered.length} of {items.length} shown · drafts require approval — nothing is sent automatically</span>
        <span className="font-mono">Agentory credits estimated locally</span>
      </div>

      <LeadDetailDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />

      {confirmAction && (
        <ConfirmDialog
          title={ACTION_LABEL[confirmAction.action]}
          rows={confirmAction.ids.length}
          credits={confirmAction.credits}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmAndDispatch}
        />
      )}
    </div>
  );
}

function Chip({ label, v, tone }: { label: string; v: number; tone: 'default' | 'good' | 'warn' | 'muted' }) {
  const cls =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200'
    : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.08] text-amber-200'
    : tone === 'muted' ? 'border-white/[0.06] bg-white/[0.02] text-[#7D8590]'
    : 'border-white/10 bg-white/[0.04] text-[#C9D1D9]';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${cls}`}>
      <span className="text-[10px] text-[#7D8590] uppercase tracking-wider">{label}</span>
      <span className="font-mono text-[11px]">{v}</span>
    </span>
  );
}

function ConfirmDialog({ title, rows, credits, onCancel, onConfirm }: { title: string; rows: number; credits: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/60 pointer-events-auto" onClick={onCancel} aria-hidden />
      <div className="relative pointer-events-auto w-[360px] max-w-full rounded-lg border border-emerald-500/30 bg-[#0a0d12] shadow-2xl p-4">
        <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">Confirm</div>
        <div className="text-[14px] font-semibold text-[#F0F6FC] mt-0.5">{title}</div>
        <div className="text-[12px] text-[#C9D1D9] mt-2">
          Run on <span className="font-mono text-emerald-200">{rows}</span> {rows === 1 ? 'lead' : 'leads'}.
          <br />Estimated cost: <span className="font-mono text-emerald-200">~{credits} Agentory credits</span>.
        </div>
        <div className="text-[10.5px] text-[#7D8590] mt-2">Nothing will be sent. Drafts require explicit approval.</div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="text-[11.5px] px-2.5 py-1 rounded border border-white/10 bg-white/[0.02] text-[#C9D1D9] hover:bg-white/[0.06]">Cancel</button>
          <button onClick={onConfirm} className="text-[11.5px] px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/[0.15] text-emerald-100 hover:bg-emerald-500/[0.25]">Confirm</button>
        </div>
      </div>
    </div>
  );
}
