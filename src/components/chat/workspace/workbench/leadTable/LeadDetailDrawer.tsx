import { useEffect, useMemo, useState } from 'react';
import {
  X, ExternalLink, Building2, Sparkles, Mail, Activity, Code2, Search, Users,
  Briefcase, Target, Linkedin, ChevronDown, ChevronRight, ShieldCheck, Copy,
  CheckCircle2,
} from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import { ContactStatusChip, RowStatusChip } from './StatusChip';
import {
  cleanMarkdownLeakage, humanizeSource, humanizeContactStatus, humanizePropertyName,
  scopeDecisionMakersToCompany, summarizeLeadStatus, hasReadableMessage,
  type DecisionMakerLike,
} from '@/lib/leadDetail';

/** Drawer reads ONLY from the selected lead's own row + that row's jsonb.
 *  No shared/global state, no fallback to another lead. Switching rows swaps
 *  the source object immediately (the parent re-looks-up the row in `items`). */

function Link({ href, label }: { href?: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">
      {label}<ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

interface Props {
  row: LeadTableRow | null;
  onClose: () => void;
}

function Section({ icon: Icon, title, children, action }: { icon: any; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-5 py-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#7D8590]">
          <Icon className="h-3 w-3 text-emerald-300/70" />
          {title}
        </div>
        {action}
      </div>
      <div className="text-[12.5px] text-[#C9D1D9] space-y-2">{children}</div>
    </section>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10.5px] uppercase tracking-wider text-[#7D8590] w-24 shrink-0">{k}</span>
      <span className="text-[12.5px] text-[#C9D1D9] min-w-0 break-words leading-relaxed">{v}</span>
    </div>
  );
}

/** 3-line clamp with show more / less — keeps long company summaries from
 *  dominating the top of the drawer. */
const LINE_CLAMP_CLASSES: Record<number, string> = {
  3: 'line-clamp-3',
  4: 'line-clamp-4',
};
function ClampedSummary({ text, lines = 4 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const cleaned = useMemo(() => cleanMarkdownLeakage(text), [text]);
  if (!cleaned) return null;
  const clampCls = LINE_CLAMP_CLASSES[lines] ?? LINE_CLAMP_CLASSES[4];
  return (
    <div>
      <p className={`text-[12.5px] text-[#9aa4af] leading-relaxed whitespace-pre-wrap ${expanded ? '' : clampCls}`}>
        {cleaned}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-[10.5px] text-emerald-300/80 hover:text-emerald-200 inline-flex items-center gap-0.5"
      >
        {expanded ? 'Show less' : 'Show more'}
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}

function ScoreTile({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const cls =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-100'
    : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-100'
    : tone === 'bad' ? 'border-rose-500/30 bg-rose-500/[0.06] text-rose-100'
    : 'border-white/[0.08] bg-white/[0.02] text-[#C9D1D9]';
  return (
    <div className={`rounded-md border px-2.5 py-1.5 min-w-0 ${cls}`}>
      <div className="text-[9px] uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="text-[12.5px] font-medium truncate mt-0.5">{value ?? '—'}</div>
    </div>
  );
}

/** Structured personalized-message card (no more raw <pre> block). Visually
 *  separates subject / opener / body / CTA. Shows recipient + status +
 *  "Nothing sent" reassurance. */
function MessageCard({ row }: { row: LeadTableRow }) {
  const body = row.personalized_message ?? '';
  const recipientName = row.contact_name ?? null;
  const recipientTitle = row.contact_title ?? null;
  const sourceCount = useMemo(() => {
    const dbRow = (row.raw && typeof row.raw === 'object' ? row.raw : {}) as Record<string, any>;
    const meta = (dbRow.raw && typeof dbRow.raw === 'object' ? dbRow.raw : dbRow) as Record<string, any>;
    const urls: string[] = Array.isArray(meta?.evidence_urls) ? meta.evidence_urls : [];
    const proof = Array.isArray(meta?.source_proof) ? meta.source_proof : [];
    return urls.length + proof.length;
  }, [row]);

  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked in some browsers */ }
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {recipientName && <div className="text-[12.5px] text-[#F0F6FC] truncate">For {recipientName}{recipientTitle ? <span className="text-[#7D8590]"> · {recipientTitle}</span> : null}</div>}
          <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">Draft · needs approval</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onCopy} className="text-[10.5px] inline-flex items-center gap-1 px-1.5 py-1 rounded border border-white/[0.08] hover:border-emerald-500/30 hover:text-emerald-200 text-[#9aa4af]">
            {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="text-[12.5px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">{cleanMarkdownLeakage(body)}</p>
      <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.04] text-[10px] text-[#7D8590]">
        <span>{sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : 'No sources'}</span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-400/70" />
          Nothing sent
        </span>
      </div>
    </div>
  );
}

export default function LeadDetailDrawer({ row, onClose }: Props) {
  // Reset scroll position when switching leads so a long previous lead's
  // scroll doesn't bleed into the new one.
  const [scrollRef, setScrollRef] = useState<HTMLDivElement | null>(null);
  const leadId = row?.id;
  useEffect(() => {
    if (scrollRef && leadId) scrollRef.scrollTo({ top: 0 });
  }, [leadId, scrollRef]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;

  const contactLocked = row.contact_status === 'needs_contact';
  const enrichLocked = row.enrichment_status !== 'enriched';
  const draftLocked = row.draft_status !== 'drafted' && row.draft_status !== 'approved';

  // Lead-scoped jsonb. The drawer reads ONLY the selected lead's own raw row,
  // never a sibling lead's data. unwrapLeadRaw is intentionally inline (and
  // duplicated from src/lib/leadRowAction.ts) so this file stays free of
  // cross-lead shared state.
  const dbRow = (row.raw && typeof row.raw === 'object' ? row.raw : {}) as Record<string, any>;
  const meta = (dbRow.raw && typeof dbRow.raw === 'object' ? dbRow.raw : dbRow) as Record<string, any>;
  const enrichment = (meta.company_enrichment && typeof meta.company_enrichment === 'object') ? meta.company_enrichment : null;

  // Defensive client-side scoping: keep only decision-makers whose company
  // membership is verified or likely for THIS lead. Weak / no-match rows are
  // shown separately under "Unverified" and never become the recommended
  // contact, even if stale jsonb leaks them in.
  const { verified: verifiedDMs, unverified: unverifiedDMs } = scopeDecisionMakersToCompany<DecisionMakerLike>(meta.decision_makers);

  // Single coherent status summary — a 20/100 weak-verdict lead is never
  // presented as contact-ready, even if the underlying status field is "new".
  const statusSummary = summarizeLeadStatus({
    verdict: row.analyst_verdict,
    final_overall_fit: row.final_overall_fit,
    fit_score: row.fit_score,
    confidence_level: row.confidence_level,
    gate_decision: row.gate_decision,
    recommended_next_action: row.recommended_next_action,
  });

  // Scenario E: when the persisted draft was written for a different contact
  // than the lead's current recommended contact, mark it visibly instead of
  // silently presenting it as written for the current person.
  const draftForCurrentContact = !row.draft_contact_id || !row.contact_id || row.draft_contact_id === row.contact_id;

  const verdictTone: 'good' | 'warn' | 'bad' | 'default' =
    statusSummary.bucket === 'high_fit' ? 'good'
    : statusSummary.bucket === 'rejected' ? 'bad'
    : statusSummary.bucket === 'watch' ? 'warn'
    : 'default';

  return (
    <div className="absolute inset-0 z-30 flex justify-end pointer-events-none">
      <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={onClose} aria-hidden />
      <aside className="relative w-[440px] max-w-full h-full bg-[#0a0d12] border-l border-white/[0.08] shadow-2xl pointer-events-auto flex flex-col">
        {/* Sticky header — content cannot scroll beneath it. */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#7D8590]">Lead detail</div>
            <div className="text-[15px] font-medium text-[#F0F6FC] truncate mt-0.5">{row.company_name ?? 'Lead'}</div>
            <div className="mt-1.5">
              <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded border ${
                verdictTone === 'good' ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200'
                : verdictTone === 'bad' ? 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200'
                : verdictTone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200'
                : 'border-white/[0.08] bg-white/[0.02] text-[#9aa4af]'
              }`}>
                {statusSummary.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.06] text-[#9aa4af] hover:text-[#F0F6FC] shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Single internal scrolling region. */}
        <div ref={setScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {/* 1. Lead overview / Company */}
          <Section icon={Building2} title="Lead overview">
            <div className="flex items-start gap-3">
              {row.company_logo && <img src={row.company_logo} alt="" className="h-9 w-9 rounded object-contain bg-white/[0.04] shrink-0" />}
              <div className="min-w-0">
                <div className="text-[13px] text-[#F0F6FC]">{row.company_name}</div>
                {row.company_slogan && <div className="text-[11px] text-[#7D8590] italic mt-0.5">{cleanMarkdownLeakage(row.company_slogan)}</div>}
              </div>
            </div>
            <Field k="Website" v={<Link href={row.website} label={row.website?.replace(/^https?:\/\//, '') ?? ''} />} />
            <Field k="LinkedIn" v={row.company_linkedin_url ? <a href={row.company_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200 inline-flex items-center gap-1"><Linkedin className="h-3 w-3" /> company page<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
            <Field k="Employees" v={typeof row.employee_count === 'number' ? `~${row.employee_count}` : null} />
            <Field k="Industries" v={(row.industries ?? []).join(' · ')} />
            <Field k="Location" v={row.company_location} />
            <Field k="Status" v={<RowStatusChip value={row.status} />} />
            {!row.website && !row.company_linkedin_url && <div className="text-[11px] text-amber-200/70 italic">No company website/LinkedIn in the source data.</div>}
          </Section>

          {/* 2. Why Agentory selected this lead — compact score summary first. */}
          <Section icon={Target} title="Why Agentory selected this lead">
            <div className="grid grid-cols-4 gap-1.5">
              <ScoreTile label="Verdict" value={row.analyst_verdict?.replace(/_/g, ' ') ?? '—'} tone={verdictTone} />
              <ScoreTile label="Fit" value={typeof (row.final_overall_fit ?? row.fit_score) === 'number' ? `${row.final_overall_fit ?? row.fit_score}/100` : null} tone={verdictTone} />
              <ScoreTile label="Confidence" value={row.confidence_level ?? '—'} />
              <ScoreTile label="Gate" value={row.gate_decision?.replace(/_/g, ' ') ?? '—'} tone={verdictTone} />
            </div>
            {statusSummary.caption && <div className="text-[11.5px] text-[#9aa4af] italic">{statusSummary.caption}</div>}
            <Field k="Why selected" v={row.why_this_lead ?? row.signal_summary} />
            <Field k="Why now" v={row.why_now} />
            <Field k="ICP fit" v={row.icp_fit_summary} />
            <Field k="Evidence" v={row.evidence_summary} />
            {(row.missing_evidence ?? []).length > 0 && <Field k="Missing" v={<span className="text-amber-200/80">{(row.missing_evidence ?? []).join('; ')}</span>} />}
            {(row.risk_flags ?? []).length > 0 && <Field k="Risks" v={<span className="text-amber-200/80">{(row.risk_flags ?? []).join('; ')}</span>} />}
            {(row.disqualifiers_hit ?? []).length > 0 && <Field k="Disqual." v={<span className="text-rose-300/80">{(row.disqualifiers_hit ?? []).join('; ')}</span>} />}
            <Field k="Next step" v={row.recommended_next_action} />
          </Section>

          {/* 3. Company enrichment — markdown-stripped + show more. */}
          {enrichment && (
            <Section icon={Search} title="Company enrichment">
              <Field k="Status" v={`${enrichment.status ?? 'n/a'}${enrichment.confidence ? ` · ${enrichment.confidence} confidence` : ''}`} />
              {enrichment.company_summary && <ClampedSummary text={enrichment.company_summary} />}
              {(enrichment.founders ?? []).length > 0 && <Field k="Founders" v={(enrichment.founders ?? []).map((f: any) => f.name).join(', ')} />}
              {(enrichment.executives ?? []).length > 0 && <Field k="Execs" v={(enrichment.executives ?? []).map((x: any) => `${x.name}${x.title ? ` (${x.title})` : ''}`).join(', ')} />}
              {(enrichment.growth_signals ?? []).length > 0 && (
                <Field k="Growth signals" v={<span className="flex flex-wrap gap-1">{(enrichment.growth_signals ?? []).slice(0, 4).map((g: any, i: number) => <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-200">{String(g)}</span>)}</span>} />
              )}
              {(enrichment.public_contact_emails ?? []).length > 0 && <Field k="Public contact" v={(enrichment.public_contact_emails ?? []).map((c: any) => c.value).join(', ')} />}
              {(enrichment.evidence_urls ?? []).length > 0 && (
                <Field k="Evidence" v={<span className="flex flex-wrap gap-1">{(enrichment.evidence_urls as string[]).slice(0, 5).map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-0.5">source {i + 1}<ExternalLink className="h-2.5 w-2.5" /></a>)}</span>} />
              )}
              {(enrichment.missing_evidence ?? []).length > 0 && (
                <Field k="Missing" v={<span className="flex flex-wrap gap-1">{(enrichment.missing_evidence as string[]).map((m: string, i: number) => <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.02] text-[#7D8590]">{humanizePropertyName(m)}</span>)}</span>} />
              )}
            </Section>
          )}

          {/* 4. Decision-makers — only company-verified people shown as normal. */}
          <Section icon={Users} title="Decision-makers">
            {verifiedDMs.length === 0 && unverifiedDMs.length === 0 ? (
              <div className="text-[11.5px] text-[#9aa4af]">
                {contactLocked
                  ? 'Run "Find decision-makers" to verify people at this company.'
                  : 'No verified decision-maker found for this company yet.'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {verifiedDMs.map((d, i) => {
                  const sourceLabel = humanizeSource((d as any).source) ?? 'Source unavailable';
                  const contactLabel = humanizeContactStatus((d as any).contact_status);
                  const highConfidence = String((d as any).confidence ?? '').toLowerCase() === 'high';
                  return (
                    <div key={`v-${i}`} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] text-[#F0F6FC] truncate">{d.name}{d.title ? <span className="text-[#7D8590]"> · {d.title}</span> : null}</div>
                        </div>
                        {(d as any).confidence && (
                          <span className={`text-[9.5px] uppercase tracking-wide shrink-0 ${highConfidence ? 'text-emerald-300' : 'text-[#7D8590]'}`}>{(d as any).confidence}</span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-[#9aa4af] mt-0.5">{sourceLabel}{contactLabel ? ` · ${contactLabel}` : ''}</div>
                      {d.why_this_person && <div className="text-[11px] text-[#9aa4af] mt-0.5 leading-relaxed">{d.why_this_person}</div>}
                      {(d as any).linkedinUrl && (
                        <a href={(d as any).linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-sky-300 hover:text-sky-200 inline-flex items-center gap-1 mt-1">
                          <Linkedin className="h-2.5 w-2.5" /> LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
                {unverifiedDMs.length > 0 && (
                  <details className="rounded-md border border-white/[0.04] bg-white/[0.01] p-2">
                    <summary className="text-[10.5px] uppercase tracking-wider text-[#7D8590] cursor-pointer inline-flex items-center gap-1">
                      <ChevronRight className="h-2.5 w-2.5" /> Unverified · {unverifiedDMs.length}
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {unverifiedDMs.map((d, i) => (
                        <div key={`u-${i}`} className="text-[11px] text-[#7D8590]">
                          <span className="text-[#9aa4af]">{d.name}</span>{d.title ? ` · ${d.title}` : ''}
                          <span className="italic"> — company match pending</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
            {meta.decision_maker_status === 'needs_manual_review' && (
              <div className="text-[11px] text-amber-200/80">No confident buyer yet — needs manual review.</div>
            )}
          </Section>

          {/* 5. Recommended contact — derived from the same scoped list. */}
          <Section icon={Briefcase} title="Recommended contact">
            <Field k="Persona" v={row.recommended_persona} />
            <Field k="Reason" v={row.recommended_persona_reason ?? (verifiedDMs[0] as any)?.why_this_person} />
            <Field k="Status" v={<ContactStatusChip status={row.contact_status} />} />
            {contactLocked ? (
              <div className="text-[11.5px] text-amber-200/80 italic">No verified contact selected. Find a decision-maker before generating outreach.</div>
            ) : (
              <>
                <Field k="Name" v={row.contact_name} />
                <Field k="Title" v={row.contact_title} />
                <Field k="Email" v={row.contact_email} />
                <Field k="LinkedIn" v={row.contact_linkedin_url ? <a href={row.contact_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200 inline-flex items-center gap-1"><Linkedin className="h-3 w-3" /> profile<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
              </>
            )}
          </Section>

          {/* 6. Personalized message — structured card, never raw <pre>. */}
          <Section icon={Mail} title="Personalized message">
            {draftLocked ? (
              <div className="text-[11.5px] text-amber-200/80 italic">
                {contactLocked
                  ? 'No verified contact selected. Find a decision-maker before generating outreach.'
                  : row.contact_name
                    ? `${row.contact_name} is ready. Generate an approval-ready draft for this contact.`
                    : 'Generate an approval-ready outreach draft for this contact.'}
              </div>
            ) : !hasReadableMessage(row.personalized_message) ? (
              <div className="text-[11.5px] text-[#9aa4af]">No readable draft yet for this contact.</div>
            ) : (
              <>
                {!draftForCurrentContact && (
                  <div className="text-[10.5px] text-amber-200/80 italic">
                    Written for a previous contact — regenerate for {row.contact_name ?? 'the current contact'} before approving.
                  </div>
                )}
                <MessageCard row={row} />
              </>
            )}
          </Section>

          {/* 7. Hiring signal — moved below message (was duplicating "why now"). */}
          {(row.job_title || row.job_url) && (
            <Section icon={Briefcase} title="Hiring signal">
              <Field k="Role" v={row.job_title ?? row.signal_type} />
              <Field k="Job post" v={<Link href={row.job_url ?? row.signal_source_url} label="view posting" />} />
              <Field k="Posted" v={row.posted_at} />
              <Field k="Seniority" v={row.seniority_level} />
              <Field k="Type" v={row.employment_type} />
              <Field k="Function" v={row.job_function} />
              <Field k="Quality" v={row.source_quality} />
              {row.job_description && <ClampedSummary text={row.job_description} lines={3} />}
            </Section>
          )}

          {/* 8. Activity */}
          <Section icon={Activity} title="Activity">
            <Field k="Status" v={row.status} />
            <Field k="Found via" v={row.found_via ?? 'exact'} />
          </Section>

          {/* 9. Raw source — collapsed by default. */}
          <details className="border-b border-white/[0.06]">
            <summary className="px-5 py-4 text-[10px] uppercase tracking-[0.12em] text-[#7D8590] cursor-pointer hover:text-[#C9D1D9] inline-flex items-center gap-1.5 select-none">
              <Code2 className="h-3 w-3" />
              View raw source data
            </summary>
            <div className="px-5 pb-4">
              <pre className="whitespace-pre-wrap text-[10.5px] text-[#7D8590] bg-black/40 rounded p-2 border border-white/[0.06] max-h-72 overflow-auto">
{JSON.stringify(meta ?? row, null, 2)}
              </pre>
            </div>
          </details>
        </div>

        {/* Footer reassurance — pinned, doesn't scroll. */}
        <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur px-5 py-2.5 flex items-center justify-between">
          <div className="text-[10px] text-[#7D8590] inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-emerald-300/70" />
            Approval-first · nothing is sent automatically
          </div>
          <div className="text-[10px] font-mono text-[#7D8590]">{row.id.slice(0, 8)}</div>
        </div>
      </aside>
    </div>
  );
}
