import { useMemo, useState } from 'react';
import {
  ExternalLink, Globe, Linkedin, Sparkles, PenLine, Star, Archive, Save,
  Download, Loader2, Filter, Building2, MapPin, User, UserSearch, Search, ArrowRight,
} from 'lucide-react';
import { useLeadResults, type LeadResultItem } from '@/hooks/useLeadResults';
import { dispatchResultAction, type LeadResultPanelAction } from '@/lib/chatActions';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';

function toCsv(items: LeadResultItem[]): string {
  const cols: (keyof LeadResultItem)[] = [
    'person_name', 'title', 'company_name', 'website', 'linkedin_url',
    'location', 'signal_type', 'signal_summary', 'fit_score', 'status',
  ];
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const header = cols.join(',');
  const rows = items.map((it) => cols.map((c) => esc(it[c])).join(','));
  return [header, ...rows].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ACTION_ICONS: Record<LeadResultPanelAction, any> = {
  enrich: Globe,
  draft_outreach: PenLine,
  enrich_and_draft: Sparkles,
  rank: Star,
  export_csv: Download,
  save_to_signal_feed: Save,
  find_contacts: UserSearch,
  research_company: Search,
};

const ACTION_LABELS: Record<LeadResultPanelAction, string> = {
  enrich: 'Enrich with Firecrawl',
  draft_outreach: 'Draft outreach with Claude',
  enrich_and_draft: 'Enrich + draft',
  rank: 'Rank by fit',
  export_csv: 'Export CSV',
  save_to_signal_feed: 'Save to Signal Feed',
  find_contacts: 'Find decision-makers',
  research_company: 'Research company',
};

function creditsFor(action: LeadResultPanelAction, leadCount: number, enrichable: number): number {
  switch (action) {
    case 'rank': return Math.ceil(leadCount / 10);
    case 'enrich': return enrichable;
    case 'draft_outreach': return leadCount * 2;
    case 'enrich_and_draft': return enrichable + leadCount * 2;
    default: return 0;
  }
}

interface Props {
  meta: LeadResultsPanelMeta;
  conversationId: string | null;
}

export default function LeadResultsView({ meta, conversationId }: Props) {
  const { items, loading, error, refresh } = useLeadResults(meta.plan_id);
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [minFit, setMinFit] = useState<number>(0);

  const filtered = useMemo(() => items.filter((it) => {
    if (onlyWithWebsite && !it.website) return false;
    if (minFit > 0 && (it.fit_score ?? 0) < minFit) return false;
    return true;
  }), [items, onlyWithWebsite, minFit]);

  const leadIds = useMemo(() => filtered.map((i) => i.lead_candidate_id), [filtered]);
  const enrichableCount = useMemo(() => filtered.filter((i) => !!i.website).length, [filtered]);

  const handle = (action: LeadResultPanelAction) => {
    if (action === 'export_csv') {
      const csv = toCsv(filtered);
      downloadCsv(`leads-${meta.plan_id.slice(0, 8)}.csv`, csv);
      return;
    }
    dispatchResultAction({
      conversationId,
      planId: meta.plan_id,
      leadCandidateIds: leadIds,
      action,
      estimatedCredits: creditsFor(action, filtered.length, enrichableCount),
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Sticky header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#F0F6FC] flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {meta.title}
            </div>
            <div className="text-[11px] text-[#7D8590] mt-0.5">{meta.subtitle}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300">
              {meta.source_type.replace(/_/g, ' ')}
            </span>
            {meta.contact_status && (
              <span className={`text-[10px] px-2 py-0.5 rounded-md border ${
                meta.contact_status === 'contact_found'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}>
                {meta.contact_status === 'contact_found' ? 'Contact found' : 'Needs contact'}
              </span>
            )}
          </div>
        </div>

        {/* Next best action */}
        {meta.next_action && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-2.5 py-1.5">
            <ArrowRight className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11.5px] text-[#F0F6FC] font-medium">Recommended: {meta.next_action.label}</div>
              <div className="text-[10.5px] text-[#7D8590]">{meta.next_action.reason}</div>
            </div>
          </div>
        )}
        {meta.contact_status === 'needs_contact' && meta.recommended_persona && (
          <div className="mt-1.5 text-[10.5px] text-[#7D8590]">
            Recommended contact: <span className="text-[#C9D1D9]">{meta.recommended_persona.personas.slice(0, 3).join(' / ')}</span> — {meta.recommended_persona.reason}
          </div>
        )}

        {/* Filters */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-[#7D8590]" />
          <button
            onClick={() => setOnlyWithWebsite((v) => !v)}
            className={`text-[10.5px] px-2 py-0.5 rounded-md border transition-colors ${
              onlyWithWebsite
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 bg-white/[0.02] text-[#9aa4af] hover:text-[#C9D1D9]'
            }`}
          >
            Has website ({items.filter((i) => !!i.website).length})
          </button>
          {[60, 75, 90].map((v) => (
            <button
              key={v}
              onClick={() => setMinFit(minFit === v ? 0 : v)}
              className={`text-[10.5px] px-2 py-0.5 rounded-md border transition-colors ${
                minFit === v
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/[0.02] text-[#9aa4af] hover:text-[#C9D1D9]'
              }`}
            >
              Fit ≥ {v}
            </button>
          ))}
          <span className="ml-auto text-[10.5px] text-[#7D8590]">
            {filtered.length} of {items.length} shown
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center text-[12px] text-[#7D8590] py-12">
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading leads…
          </div>
        )}
        {error && (
          <div className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md p-2">
            {error} <button onClick={refresh} className="underline ml-2">Retry</button>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-[12px] text-[#7D8590] py-12 text-center">
            No leads match these filters.
          </div>
        )}

        {filtered.length > 0 && (
          <ul className="space-y-2">
            {filtered.map((it) => (
              <li
                key={it.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-[#F0F6FC] inline-flex items-center gap-1.5">
                        {it.person_name ? <User className="h-3.5 w-3.5 text-emerald-300" /> : <Building2 className="h-3.5 w-3.5 text-emerald-300" />}
                        {it.person_name ?? it.company_name ?? 'Lead'}
                      </span>
                      {typeof it.fit_score === 'number' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono">
                          fit {it.fit_score}
                        </span>
                      )}
                      {it.status && it.status !== 'new' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-[#9aa4af]">
                          {it.status}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[#C9D1D9] mt-0.5">
                      {[it.title, it.company_name].filter(Boolean).join(' · ')}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[#7D8590] flex-wrap">
                      {it.location && (
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {it.location}</span>
                      )}
                      {it.signal_type && (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-emerald-300/80" /> {it.signal_type}
                        </span>
                      )}
                    </div>
                    {it.fit_reason && (
                      <div className="text-[11px] text-[#9aa4af] mt-1.5 line-clamp-2">{it.fit_reason}</div>
                    )}
                    {!it.person_name && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-amber-300/80">
                        <UserSearch className="h-3 w-3" /> Decision-maker not found yet
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {it.website && (
                      <a href={it.website} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200">
                        <Globe className="h-3 w-3" /> Site <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    {it.linkedin_url && (
                      <a href={it.linkedin_url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200">
                        <Linkedin className="h-3 w-3" /> LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="border-t border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur px-3 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(meta.actions as LeadResultPanelAction[]).map((a) => {
            const Icon = ACTION_ICONS[a] ?? Star;
            const credits = creditsFor(a, filtered.length, enrichableCount);
            const disabled = filtered.length === 0;
            return (
              <button
                key={a}
                onClick={() => handle(a)}
                disabled={disabled}
                title={ACTION_LABELS[a]}
                className="inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.08] hover:border-emerald-500/30 hover:text-[#F0F6FC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon className="h-3 w-3" />
                {ACTION_LABELS[a]}
                {credits > 0 && (
                  <span className="text-[10px] text-emerald-300/80 ml-0.5">~{credits}c</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[10px] text-[#7D8590]">
          Estimated Agentory credits. Drafts require approval — nothing is sent automatically.
        </div>
      </div>
    </div>
  );
}
