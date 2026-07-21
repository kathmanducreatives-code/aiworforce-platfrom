import { useEffect } from 'react';
import {
  deriveLeadDetailState, RESEARCH_STATE_COPY, OUTREACH_STATE_COPY, RECIPIENT_UNKNOWN_COPY,
} from '@/lib/leadDetailState';
import { X, ExternalLink, Building2, User, Sparkles, Mail, FileText, Activity, Code2, Search, Users, Briefcase, Target, Linkedin } from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import { ContactStatusChip, RowStatusChip } from './StatusChip';

function Link({ href, label }: { href?: string | null; label: string }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">{label}<ExternalLink className="h-2.5 w-2.5" /></a>;
}
function excerpt(s?: string | null, n = 320) { return s ? (s.length > n ? s.slice(0, n) + '…' : s) : null; }

interface Props {
  row: LeadTableRow | null;
  onClose: () => void;
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#7D8590] mb-1.5">
        <Icon className="h-3 w-3 text-emerald-300/70" />
        {title}
      </div>
      <div className="text-[12px] text-[#C9D1D9] space-y-1">{children}</div>
    </section>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10.5px] uppercase tracking-wider text-[#7D8590] w-20 shrink-0">{k}</span>
      <span className="text-[12px] text-[#C9D1D9] min-w-0 break-words">{v}</span>
    </div>
  );
}

export default function LeadDetailDrawer({ row, onClose }: Props) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  const contactLocked = row.contact_status === 'needs_contact';
  // Canonical per-lead state. The flat `enrichment_status` / `draft_status`
  // columns are sourcing-era fields the Workbench never updates — reading them
  // is why a lead with completed research and a persisted opener still showed
  // "Locked". They survive inside deriveLeadDetailState as legacy fallbacks.
  const detail = deriveLeadDetailState(row);
  const enrichLocked = detail.researchLocked;
  const draftLocked = detail.outreachLocked;
  // useLeadResults sets row.raw to the DB row; the persisted lead_action results
  // (company_enrichment, decision_makers) live in the jsonb one level deeper.
  const dbRow = (row.raw && typeof row.raw === 'object' ? row.raw : {}) as Record<string, any>;
  const meta = (dbRow.raw && typeof dbRow.raw === 'object' ? dbRow.raw : dbRow) as Record<string, any>;
  const enrichment = (meta.company_enrichment && typeof meta.company_enrichment === 'object') ? meta.company_enrichment : null;
  const decisionMakers = Array.isArray(meta.decision_makers) ? meta.decision_makers : [];

  return (
    <div className="absolute inset-0 z-30 flex justify-end pointer-events-none">
      <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={onClose} aria-hidden />
      <aside className="relative w-[420px] max-w-full h-full bg-[#0a0d12] border-l border-white/[0.08] shadow-2xl overflow-y-auto pointer-events-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">Lead detail</div>
            <div className="text-[13px] font-medium text-[#F0F6FC] truncate">{row.company_name ?? 'Lead'}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] text-[#9aa4af] hover:text-[#F0F6FC]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Part D.1 — Company evidence (from the Apify LinkedIn-Jobs payload) */}
        <Section icon={Building2} title="Company">
          <div className="flex items-start gap-2 mb-1">
            {row.company_logo && <img src={row.company_logo} alt="" className="h-8 w-8 rounded object-contain bg-white/[0.04] shrink-0" />}
            <div className="min-w-0">
              <div className="text-[12.5px] text-[#F0F6FC]">{row.company_name}</div>
              {row.company_slogan && <div className="text-[10.5px] text-[#7D8590] italic">{row.company_slogan}</div>}
            </div>
          </div>
          <Field k="Website" v={<Link href={row.website} label={row.website?.replace(/^https?:\/\//, '') ?? ''} />} />
          <Field k="LinkedIn" v={row.company_linkedin_url ? <a href={row.company_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200 inline-flex items-center gap-1"><Linkedin className="h-2.5 w-2.5" /> company page<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
          <Field k="Employees" v={typeof row.employee_count === 'number' ? `~${row.employee_count}` : null} />
          <Field k="Industries" v={(row.industries ?? []).join(' · ')} />
          <Field k="Location" v={row.company_location} />
          <Field k="About" v={excerpt(row.company_description, 400)} />
          <Field k="Status" v={<RowStatusChip value={row.status} />} />
          {!row.website && !row.company_linkedin_url && <div className="text-[10.5px] text-amber-200/70 italic">No company website/LinkedIn in the source data.</div>}
        </Section>

        {/* Part D.2 — Hiring signal (the exact job posting + proof) */}
        <Section icon={Briefcase} title="Hiring signal">
          <Field k="Role" v={row.job_title ?? row.signal_type} />
          <Field k="Job post" v={<Link href={row.job_url ?? row.signal_source_url} label="view posting" />} />
          <Field k="Apply" v={<Link href={row.apply_url} label="apply link" />} />
          <Field k="Posted" v={row.posted_at} />
          <Field k="Seniority" v={row.seniority_level} />
          <Field k="Type" v={row.employment_type} />
          <Field k="Function" v={row.job_function} />
          <Field k="Salary" v={row.salary} />
          <Field k="Applicants" v={typeof row.applicants_count === 'number' ? `${row.applicants_count}` : null} />
          <Field k="Quality" v={row.source_quality} />
          {row.job_description && <div className="text-[11.5px] text-[#9aa4af] mt-1">{excerpt(row.job_description, 500)}</div>}
        </Section>

        {/* Part D.3 — Why Agentory selected this lead */}
        <Section icon={Target} title="Why Agentory selected this lead">
          <Field k="Verdict" v={row.analyst_verdict} />
          <Field k="Fit" v={typeof (row.final_overall_fit ?? row.fit_score) === 'number' ? `${row.final_overall_fit ?? row.fit_score}/100` : null} />
          <Field k="Confidence" v={row.confidence_level} />
          <Field k="Gate" v={row.gate_decision} />
          <Field k="Why selected" v={row.why_this_lead ?? row.signal_summary} />
          <Field k="Why now" v={row.why_now} />
          <Field k="ICP fit" v={row.icp_fit_summary} />
          <Field k="Evidence" v={row.evidence_summary} />
          {(row.missing_evidence ?? []).length > 0 && <Field k="Missing" v={<span className="text-amber-200/80">{(row.missing_evidence ?? []).join('; ')}</span>} />}
          {(row.risk_flags ?? []).length > 0 && <Field k="Risks" v={<span className="text-amber-200/80">{(row.risk_flags ?? []).join('; ')}</span>} />}
          {(row.disqualifiers_hit ?? []).length > 0 && <Field k="Disqual." v={<span className="text-rose-300/80">{(row.disqualifiers_hit ?? []).join('; ')}</span>} />}
          <Field k="Next step" v={row.recommended_next_action} />
        </Section>

        {/* Poster/contact hint from the job post (not a verified buyer) */}
        {(row.poster_name || row.poster_profile_url) && (
          <Section icon={User} title="Contact hint">
            <div className="flex items-center gap-2">
              {row.poster_photo && <img src={row.poster_photo} alt="" className="h-7 w-7 rounded-full object-cover" />}
              <div className="min-w-0">
                <div className="text-[12px] text-[#F0F6FC] truncate">{row.poster_name ?? '—'}</div>
                <div className="text-[10.5px] text-[#7D8590] truncate">{row.poster_title ?? 'Job poster'}</div>
              </div>
            </div>
            <Field k="Profile" v={<Link href={row.poster_profile_url} label="LinkedIn" />} />
            <div className="text-[10px] text-[#7D8590] italic mt-1">Hint from the job post — not a verified decision-maker.</div>
          </Section>
        )}

        {enrichment && (
          <Section icon={Search} title="Company enrichment">
            <Field k="Status" v={`${enrichment.status ?? 'n/a'} · ${enrichment.confidence ?? '—'} confidence`} />
            <Field k="Summary" v={enrichment.company_summary} />
            <Field k="Founders" v={(enrichment.founders ?? []).map((f: any) => f.name).join(', ')} />
            <Field k="Execs" v={(enrichment.executives ?? []).map((x: any) => `${x.name}${x.title ? ` (${x.title})` : ''}`).join(', ')} />
            <Field k="Growth" v={(enrichment.growth_signals ?? []).slice(0, 3).join(' · ')} />
            <Field k="Contact" v={(enrichment.public_contact_emails ?? []).map((c: any) => c.value).join(', ')} />
            {(enrichment.evidence_urls ?? []).length > 0 && (
              <Field k="Evidence" v={<span className="flex flex-wrap gap-1">{(enrichment.evidence_urls as string[]).slice(0, 5).map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-0.5">src{i + 1}<ExternalLink className="h-2.5 w-2.5" /></a>)}</span>} />
            )}
            <Field k="Missing" v={(enrichment.missing_evidence ?? []).length ? <span className="text-amber-200/80">{(enrichment.missing_evidence as string[]).join(', ')}</span> : null} />
          </Section>
        )}

        {decisionMakers.length > 0 && (
          <Section icon={Users} title="Decision-makers">
            {decisionMakers.slice(0, 6).map((d: any, i: number) => (
              <div key={i} className="rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[#F0F6FC] truncate">{d.name}{d.title ? <span className="text-[#7D8590]"> · {d.title}</span> : null}</span>
                  <span className="text-[9px] uppercase tracking-wide text-[#7D8590] shrink-0">{d.confidence}</span>
                </div>
                <div className="text-[10px] text-[#7D8590] mt-0.5">
                  {d.source}{d.source === 'job_poster' ? <span className="text-amber-300/80"> — poster hint, not a verified buyer</span> : null} · {d.contact_status}
                </div>
                {d.why_this_person && <div className="text-[10.5px] text-[#9aa4af] mt-0.5">{d.why_this_person}</div>}
                {d.linkedinUrl && <a href={d.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-sky-300 hover:text-sky-200 inline-flex items-center gap-0.5 mt-0.5">LinkedIn<ExternalLink className="h-2.5 w-2.5" /></a>}
              </div>
            ))}
            {meta.decision_maker_status === 'needs_manual_review' && (
              <div className="text-[10.5px] text-amber-200/80">No confident buyer yet — needs manual review.</div>
            )}
          </Section>
        )}

        {detail.opener && (
          <Section icon={User} title="Selected outreach recipient">
            {detail.selectedRecipientName ? (
              <>
                <Field k="Name" v={detail.selectedRecipientName} />
                <Field k="Title" v={detail.selectedRecipientTitle} />
                <div className="text-[10.5px] text-[#7D8590] mt-0.5">Used for this personalized opener</div>
              </>
            ) : (
              <div className="text-[11px] text-amber-200/80 italic">{RECIPIENT_UNKNOWN_COPY}</div>
            )}
          </Section>
        )}

        <Section icon={User} title={detail.opener ? 'Other verified contacts' : 'Recommended contact'}>
          <Field k="Persona" v={row.recommended_persona} />
          <Field k="Reason" v={row.recommended_persona_reason} />
          <Field k="Status" v={<ContactStatusChip status={row.contact_status} />} />
          {contactLocked ? (
            <div className="text-[11px] text-amber-200/80 italic mt-1">Locked — run "Find decision-makers" to unlock contact details.</div>
          ) : (
            <>
              <Field k="Name" v={row.contact_name} />
              <Field k="Title" v={row.contact_title} />
              <Field k="Email" v={row.contact_email} />
              <Field k="LinkedIn" v={row.contact_linkedin_url ? <a href={row.contact_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200 inline-flex items-center gap-1">profile<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
            </>
          )}
        </Section>

        <Section icon={FileText} title="Enrichment">
          {enrichLocked ? (
            <div className="text-[11px] text-amber-200/80 italic">{RESEARCH_STATE_COPY[detail.research]} — run "Research company context" to enrich.</div>
          ) : (
            <>
              <Field k="Status" v={RESEARCH_STATE_COPY[detail.research]} />
              <Field k="Summary" v={row.enrichment_summary} />
              <Field k="Angles" v={(row.personalization_angles ?? []).join(' · ')} />
            </>
          )}
        </Section>

        <Section icon={Mail} title="Personalized message">
          {draftLocked ? (
            <div className="text-[11px] text-amber-200/80 italic">
              {row.contact_status === 'needs_contact'
                ? 'Blocked — find a decision-maker before drafting outreach.'
                : 'Locked — run "Generate approval-ready outreach" to draft.'}
            </div>
          ) : (
            <>
              <Field k="Status" v={OUTREACH_STATE_COPY[detail.outreach]} />
              <pre className="whitespace-pre-wrap text-[12px] text-[#C9D1D9] bg-white/[0.02] rounded p-2 border border-white/[0.06]">{detail.opener?.opener ?? row.personalized_message}</pre>
              {detail.opener?.generated_at && (
                <div className="text-[10px] text-[#7D8590] mt-1">Generated {new Date(detail.opener.generated_at).toLocaleString()}</div>
              )}
              <div className="text-[10px] text-[#7D8590] mt-0.5">Approval required · Nothing sent</div>
            </>
          )}
        </Section>

        <Section icon={Activity} title="Activity">
          <Field k="Status" v={row.status} />
          <Field k="Found via" v={row.found_via ?? 'exact'} />
        </Section>

        <Section icon={Code2} title="Raw source">
          <pre className="whitespace-pre-wrap text-[10.5px] text-[#7D8590] bg-black/40 rounded p-2 border border-white/[0.06] max-h-64 overflow-auto">
{JSON.stringify(meta ?? row, null, 2)}
          </pre>
        </Section>
      </aside>
    </div>
  );
}
