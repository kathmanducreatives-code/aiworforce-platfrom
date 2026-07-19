import { ExternalLink, Linkedin, Globe, Loader2 } from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';
import type { LeadActionKind } from '@/lib/leadActionRequest';
import { companyDisplayLinks, rowActionCopy, type RowAction } from '@/lib/leadRowAction';
import {
  personaLabel, titleCompanyLine, verificationLine, emailStatusCopy,
  ROW_STATUS_HEADLINE, ROW_STATUS_DETAIL,
} from '@/lib/decisionMakerDisplay';
import { evidenceLine, missingLine, RESEARCH_STATUS_COPY } from '@/lib/companyResearchDisplay';
import { icpFitLine, topFitReasons, topMissing, NO_TRIGGER_COPY } from '@/lib/icpSnapshot';
import type { WorkbenchAccountView } from '@/lib/workbenchAccountView';
import { DEPTH_LABEL, OPENER_APPROVAL_NOTICE, type OutreachRowHint } from '@/lib/outreachOpener';
import LockedCell from './LockedCell';
import { ContactStatusChip, RowStatusChip } from './StatusChip';

// Per-row action lifecycle (Part E). Written by LeadResultsView, rendered here
// on the matching unlock cell — the row is the source of truth, not a chat log.
export type { RowAction } from '@/lib/leadRowAction';

interface Props {
  rows: LeadTableRow[];
  selected: Set<string>;
  rowActions?: Record<string, RowAction>;
  /** Persistent per-stage account state. Completed stages render from HERE. */
  accountViews?: Record<string, WorkbenchAccountView>;
  /** Per-row personalized-opener hint (opener or a SPECIFIC blocker). */
  outreachHints?: Record<string, OutreachRowHint>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: LeadTableRow) => void;
  onUnlock: (action: LeadResultPanelAction, rowId: string) => void;
}

// Tone per canonical status. A rejected request and a genuinely empty provider
// result are visually distinct: only the former is a fault to act on.
const STATUS_TONE: Record<string, string> = {
  succeeded: 'text-emerald-300',
  no_match: 'text-slate-300/80',
  unavailable: 'text-slate-300/80',
  missing_company_identity: 'text-amber-200/80',
  needs_manual_review: 'text-amber-200/80',
  blocked: 'text-amber-200/80',
  timed_out: 'text-rose-300',
  failed: 'text-rose-300',
  request_error: 'text-rose-300',
};

// Copy comes from the canonical status the backend assigned — the cell never
// re-derives an outcome from provider-shaped fields.
function RowActionCell({ a, kind }: { a: RowAction; kind: LeadActionKind }) {
  if (a.status === 'running') {
    const label = kind === 'research_company' ? 'Researching company…' : kind === 'find_decision_makers' ? 'Finding decision-makers…' : 'Preparing draft…';
    return <div className="px-2 py-1.5 text-[10.5px] text-sky-300 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{label}</div>;
  }

  const tone = STATUS_TONE[a.status] ?? 'text-slate-300/80';

  // Structured rendering for a verified decision-maker: the person's name is the
  // strongest element, with title/company and verification as supporting lines.
  // Never a prose sentence with an interpolated value.
  const dm = a.decisionMakers?.primary_decision_maker;
  if (kind === 'find_decision_makers' && a.status === 'succeeded' && dm) {
    const extra = a.decisionMakers?.additional_decision_makers.length ?? 0;
    return (
      <div className="px-2 py-1.5 space-y-0.5 min-w-0">
        <div className="text-[12px] font-medium text-[#E6EDF3] truncate" title={dm.full_name}>
          {dm.full_name}
        </div>
        {titleCompanyLine(dm) && (
          <div className="text-[10.5px] text-[#8B949E] line-clamp-2">{titleCompanyLine(dm)}</div>
        )}
        <div className="text-[10px] text-emerald-300/90 inline-flex items-center gap-1">
          <span aria-hidden="true">✓</span>
          <span>{verificationLine(dm)}</span>
        </div>
        {extra > 0 && (
          <div className="text-[10px] text-sky-300/80">+{extra} more verified</div>
        )}
      </div>
    );
  }

  const copy = rowActionCopy(a);
  const detail = a.decisionMakers ? ROW_STATUS_DETAIL[a.decisionMakers.status] : '';

  return (
    // The hover title repeats the human copy, never the raw reason code —
    // `blocked_missing_company_brain` is an internal identifier and reads as a
    // system error to the user. The code stays on the RowAction for
    // observability and retry logic; it just isn't rendered.
    <div className={`px-2 py-1.5 text-[10.5px] ${tone} space-y-0.5`} title={copy}>
      <div className="line-clamp-2">{copy}</div>
      {kind === 'find_decision_makers' && detail && (
        <div className="text-[10px] text-[#7D8590] line-clamp-2">{detail}</div>
      )}
    </div>
  );
}

const COL_W = {
  select: 'w-9',
  company: 'min-w-[200px]',
  signal: 'min-w-[220px]',
  context: 'min-w-[220px]',
  analyst: 'min-w-[240px]',
  persona: 'min-w-[140px]',
  contactStatus: 'min-w-[120px]',
  decisionMaker: 'min-w-[180px]',
  contactInfo: 'min-w-[180px]',
  enrichment: 'min-w-[200px]',
  message: 'min-w-[200px]',
  fit: 'w-[70px]',
  source: 'min-w-[120px]',
  status: 'w-[90px]',
};

export default function LeadTable({ rows, selected, rowActions, accountViews, outreachHints, onToggle, onToggleAll, onOpen, onUnlock }: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead className="sticky top-0 z-[4] bg-[#0a0d12] backdrop-blur">
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-[#7D8590]">
            <th className={`${COL_W.select} sticky left-0 z-[5] bg-[#0a0d12] border-b border-r border-white/[0.08] px-2 py-2`}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={onToggleAll}
                className="h-3 w-3 rounded accent-emerald-500 cursor-pointer"
                aria-label="Select all"
              />
            </th>
            <th className={`${COL_W.company} sticky left-9 z-[5] bg-[#0a0d12] border-b border-r border-white/[0.08] px-2 py-2`}>Company / Account</th>
            <th className={`${COL_W.signal} border-b border-white/[0.08] px-2 py-2`}>Signal</th>
            <th className={`${COL_W.context} border-b border-white/[0.08] px-2 py-2`}>Company Context</th>
            <th className={`${COL_W.analyst} border-b border-white/[0.08] px-2 py-2`}>Analyst</th>
            <th className={`${COL_W.persona} border-b border-white/[0.08] px-2 py-2`}>Recommended Persona</th>
            <th className={`${COL_W.contactStatus} border-b border-white/[0.08] px-2 py-2`}>Contact Status</th>
            <th className={`${COL_W.decisionMaker} border-b border-white/[0.08] px-2 py-2`}>Decision Maker 🔒</th>
            <th className={`${COL_W.contactInfo} border-b border-white/[0.08] px-2 py-2`}>Contact Info 🔒</th>
            <th className={`${COL_W.enrichment} border-b border-white/[0.08] px-2 py-2`}>Company Enrichment 🔒</th>
            <th className={`${COL_W.message} border-b border-white/[0.08] px-2 py-2`}>Personalized Message 🔒</th>
            <th className={`${COL_W.fit} border-b border-white/[0.08] px-2 py-2`}>Fit</th>
            <th className={`${COL_W.source} border-b border-white/[0.08] px-2 py-2`}>Source</th>
            <th className={`${COL_W.status} border-b border-white/[0.08] px-2 py-2`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = selected.has(r.id);
            const contactLocked = r.contact_status === 'needs_contact';
            const enrichLocked = r.enrichment_status !== 'enriched';
            const draftLocked = r.draft_status !== 'drafted' && r.draft_status !== 'approved';
            return (
              <tr
                key={r.id}
                className={`group ${isSel ? 'bg-emerald-500/[0.05]' : 'hover:bg-white/[0.02]'}`}
              >
                <td className={`${COL_W.select} sticky left-0 z-[1] bg-[#0a0d12] border-b border-r border-white/[0.05] px-2`}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggle(r.id)}
                    className="h-3 w-3 rounded accent-emerald-500 cursor-pointer"
                  />
                </td>
                <td className={`${COL_W.company} sticky left-9 z-[1] bg-[#0a0d12] border-b border-r border-white/[0.05] px-2 py-1.5`}>
                  <button onClick={() => onOpen(r)} className="text-left w-full block">
                    <div className="text-[12.5px] font-medium text-[#F0F6FC] truncate">{r.company_name ?? 'Unknown company'}</div>
                  </button>
                  {/* website + company LinkedIn as separate clickable links (stop
                      propagation so they don't open the drawer) */}
                  {(() => { const links = companyDisplayLinks(r); return (
                  <div className="flex items-center gap-2 mt-0.5">
                    {links.website ? (
                      <a href={links.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10.5px] text-[#9aa4af] hover:text-emerald-300 inline-flex items-center gap-1 min-w-0">
                        <Globe className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{links.websiteHost}</span>
                      </a>
                    ) : (
                      <span className="text-[10.5px] text-amber-300/80">no website</span>
                    )}
                    {links.linkedinUrl && (
                      <a href={links.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10.5px] text-sky-300/80 hover:text-sky-200 inline-flex items-center gap-0.5 shrink-0">
                        <Linkedin className="h-2.5 w-2.5" /> LinkedIn
                      </a>
                    )}
                  </div>
                  ); })()}
                </td>
                <td className={`${COL_W.signal} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <div className="text-[11.5px] text-[#F0F6FC] truncate">{r.job_title ?? r.signal_type ?? '—'}</div>
                  <div className="text-[10px] text-[#7D8590] truncate">{r.job_title ? (r.signal_type ?? '') : ''}{r.posted_at ? ` · ${r.posted_at}` : ''}</div>
                  {(r.job_url || r.signal_source_url) && (
                    <a href={(r.job_url || r.signal_source_url) as string} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] inline-flex items-center gap-1 text-emerald-300/80 hover:text-emerald-200">
                      view proof <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  {(r.why_now || r.signal_summary) && (
                    <div className="text-[10px] text-[#7D8590] line-clamp-2 mt-0.5">{r.why_now ?? r.signal_summary}</div>
                  )}
                </td>
                <td className={`${COL_W.context} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <div className="text-[10.5px] text-[#9aa4af] flex flex-wrap gap-x-2">
                    {typeof r.employee_count === 'number' && <span>~{r.employee_count} emp</span>}
                    {(r.industries ?? []).length > 0 && <span className="truncate">{(r.industries ?? []).slice(0, 2).join(', ')}</span>}
                  </div>
                  {r.company_description ? (
                    <div className="text-[10px] text-[#7D8590] line-clamp-3 mt-0.5">{r.company_description}</div>
                  ) : (
                    <div className="text-[10px] text-[#7D8590]/60 italic">no company description</div>
                  )}
                </td>
                <td className={`${COL_W.analyst} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  {r.analyst_verdict ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded ${
                        r.analyst_verdict === 'strong' ? 'bg-emerald-500/15 text-emerald-300'
                        : r.analyst_verdict === 'needs_verification' ? 'bg-amber-500/15 text-amber-200'
                        : 'bg-white/[0.06] text-[#9aa4af]'
                      }`}>{r.analyst_verdict.replace(/_/g, ' ')}</span>
                      {typeof (r.final_overall_fit ?? r.fit_score) === 'number' && (
                        <span className="text-[10px] font-mono text-emerald-200">{r.final_overall_fit ?? r.fit_score}</span>
                      )}
                      {r.confidence_level && <span className="text-[9px] text-[#7D8590]">{r.confidence_level}</span>}
                    </div>
                  ) : <span className="text-[10px] text-[#7D8590]">—</span>}
                  {r.icp_fit_summary && <div className="text-[10px] text-[#9aa4af] line-clamp-2 mt-0.5">{r.icp_fit_summary}</div>}
                  {(r.missing_evidence ?? []).length > 0 && (
                    <div className="text-[9.5px] text-amber-200/70 line-clamp-1 mt-0.5">missing: {(r.missing_evidence ?? []).join(', ')}</div>
                  )}
                </td>
                <td className={`${COL_W.persona} border-b border-white/[0.05] px-2 py-1.5 align-top text-[11.5px] text-[#C9D1D9]`}>
                  {r.recommended_persona ?? <span className="text-[#7D8590]">—</span>}
                </td>
                <td className={`${COL_W.contactStatus} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <ContactStatusChip status={r.contact_status} />
                </td>
                <td className={`${COL_W.decisionMaker} border-b border-white/[0.05] align-top p-0`}>
                  {rowActions?.[r.id]?.kind === 'find_decision_makers' ? (
                    <RowActionCell a={rowActions[r.id]} kind="find_decision_makers" />
                  ) : contactLocked ? (
                    <LockedCell label="Find decision-maker" credits={1} onUnlock={() => onUnlock('find_contacts', r.id)} />
                  ) : (
                    <div className="px-2 py-1.5">
                      <div className="text-[11.5px] text-[#F0F6FC] truncate">{r.contact_name ?? '—'}</div>
                      <div className="text-[10.5px] text-[#7D8590] truncate">{r.contact_title ?? ''}</div>
                    </div>
                  )}
                </td>
                <td className={`${COL_W.contactInfo} border-b border-white/[0.05] align-top p-0`}>
                  {contactLocked ? (
                    <LockedCell label="Enrich contact" credits={1} onUnlock={() => onUnlock('find_contacts', r.id)} />
                  ) : (
                    (() => {
                      const dmView = rowActions?.[r.id]?.kind === 'find_decision_makers'
                        ? rowActions[r.id].decisionMakers?.primary_decision_maker
                        : undefined;
                      // Prefer the freshly-verified profile over the stored one.
                      const liUrl = dmView?.linkedin_url ?? r.contact_linkedin_url ?? null;
                      const personName = dmView?.full_name ?? null;
                      return (
                        <div className="px-2 py-1.5 space-y-1">
                          {dmView && (
                            <div className="text-[10px] text-sky-300/90">{personaLabel(dmView.role_family)}</div>
                          )}
                          {liUrl && (
                            <a
                              href={liUrl}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={personName ? `Open LinkedIn profile for ${personName} in a new tab` : 'Open LinkedIn profile in a new tab'}
                              className="text-[10.5px] inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 focus:outline-none focus:ring-1 focus:ring-sky-400/60 rounded"
                            >
                              <Linkedin className="h-2.5 w-2.5" aria-hidden="true" /> Open LinkedIn
                              <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                            </a>
                          )}
                          {r.contact_email ? (
                            <div className="text-[11.5px] text-emerald-200 truncate">{r.contact_email}</div>
                          ) : (
                            // Never "no email" — that claims a provider proved none exists.
                            <div className="text-[10.5px] text-[#7D8590]">{emailStatusCopy('not_enriched')}</div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </td>
                <td className={`${COL_W.enrichment} border-b border-white/[0.05] align-top p-0`}>
                  {(() => {
                    const view = accountViews?.[r.id];
                    const research = view?.company_research.last_success ?? null;
                    const running = rowActions?.[r.id]?.kind === 'research_company'
                      && rowActions[r.id].status === 'running';
                    if (running) return <RowActionCell a={rowActions[r.id]} kind="research_company" />;
                    // Completed research renders from PERSISTENT stage state, so a
                    // later action (outreach, decision-makers) cannot hide it.
                    if (research) {
                      const icp = view?.icp_snapshot ?? null;
                      const missing = missingLine(research);
                      return (
                        <div className="px-2 py-1.5 space-y-1 min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-[#7D8590]">
                            {RESEARCH_STATUS_COPY[research.status]}
                            {research.confidence ? ` · ${research.confidence} confidence` : ''}
                          </div>
                          {research.summary && (
                            <div className="text-[11px] text-[#C9D1D9] line-clamp-2">{research.summary}</div>
                          )}
                          {icp && (
                            <div className="text-[10.5px] text-sky-300/90">
                              {icpFitLine(icp)}
                              {topFitReasons(icp).length > 0 && (
                                <span className="text-[#8B949E]"> · {topFitReasons(icp).join(' · ')}</span>
                              )}
                            </div>
                          )}
                          {icp && icp.buying_moment_fit.status !== 'supported' && (
                            <div className="text-[10px] text-[#7D8590]">{NO_TRIGGER_COPY}</div>
                          )}
                          <div className="text-[10px] text-[#7D8590]">
                            <span aria-label={`${research.evidence_count} evidence sources`}>{evidenceLine(research)}</span>
                            {missing && <span> · Missing: {missing}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpen(r); }}
                            className="text-[10.5px] text-sky-300 hover:text-sky-200 focus:outline-none focus:ring-1 focus:ring-sky-400/60 rounded"
                            aria-label={`View research for ${r.company_name ?? 'this company'}`}
                          >
                            View research →
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })() ?? (enrichLocked ? (
                    <LockedCell
                      label={r.domain_status === 'missing' ? 'Needs domain' : 'Research company'}
                      credits={r.domain_status === 'missing' ? 0 : 1}
                      onUnlock={() => onUnlock('research_company', r.id)}
                      disabled={r.domain_status === 'missing'}
                    />
                  ) : (
                    <div className="px-2 py-1.5 text-[11px] text-[#C9D1D9] line-clamp-2">{r.enrichment_summary ?? '—'}</div>
                  ))}
                </td>
                <td className={`${COL_W.message} border-b border-white/[0.05] align-top p-0`}>
                  {(() => {
                    if (rowActions?.[r.id]?.kind === 'generate_outreach') {
                      return <RowActionCell a={rowActions[r.id]} kind="generate_outreach" />;
                    }
                    const hint = outreachHints?.[r.id];
                    // A persisted personalized OPENER (not a full email) renders directly.
                    if (hint?.opener) {
                      return (
                        <div className="px-2 py-1.5 space-y-1 min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-[#7D8590]">Personalized opener</div>
                          <div className="text-[11px] text-[#C9D1D9] line-clamp-3">{hint.opener}</div>
                          <div className="text-[10px] text-[#7D8590]">
                            {DEPTH_LABEL[hint.personalization_depth]}
                            {hint.source_count > 0 && ` · ${hint.source_count} verified source${hint.source_count === 1 ? '' : 's'}`}
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r); }} className="text-[10.5px] text-sky-300 hover:text-sky-200 focus:outline-none rounded" aria-label={`Review opener for ${r.company ?? 'this company'}`}>Review</button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(hint.opener ?? ''); }} className="text-[10.5px] text-[#9aa4af] hover:text-[#C9D1D9] focus:outline-none rounded" aria-label="Copy opener">Copy</button>
                          </div>
                          <div className="text-[9.5px] text-[#7D8590]">{OPENER_APPROVAL_NOTICE}</div>
                        </div>
                      );
                    }
                    // A SPECIFIC blocker — never "Complete the required previous step first".
                    if (hint?.blocker_copy) {
                      return <div className="px-2 py-1.5 text-[11px] text-amber-300/90 line-clamp-2">{hint.blocker_copy}</div>;
                    }
                    if (draftLocked) {
                      return (
                        <LockedCell
                          label={r.contact_status === 'needs_contact' ? 'Needs contact' : 'Generate outreach'}
                          credits={r.contact_status === 'needs_contact' ? 0 : 2}
                          onUnlock={() => onUnlock('draft_outreach', r.id)}
                          disabled={r.contact_status === 'needs_contact'}
                        />
                      );
                    }
                    return <div className="px-2 py-1.5 text-[11px] text-[#C9D1D9] line-clamp-2">{r.personalized_message ?? '—'}</div>;
                  })()}
                </td>
                <td className={`${COL_W.fit} border-b border-white/[0.05] px-2 py-1.5 align-top font-mono text-[11px] text-emerald-200`}>
                  {typeof r.fit_score === 'number' ? (
                    <div>
                      <div>{r.fit_score}</div>
                      {r.fit_tier && (
                        <div className={`text-[8.5px] uppercase tracking-wide mt-0.5 ${
                          r.fit_tier === 'hot' ? 'text-emerald-300'
                          : r.fit_tier === 'qualified' ? 'text-emerald-400/70'
                          : r.fit_tier === 'weak' ? 'text-amber-300/70'
                          : 'text-[#7D8590]'
                        }`}>{r.fit_tier}</div>
                      )}
                    </div>
                  ) : <span className="text-[#7D8590]">—</span>}
                </td>
                <td className={`${COL_W.source} border-b border-white/[0.05] px-2 py-1.5 align-top text-[11px] text-[#9aa4af] truncate`}>
                  {r.signal_type ?? '—'}
                </td>
                <td className={`${COL_W.status} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <RowStatusChip value={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
