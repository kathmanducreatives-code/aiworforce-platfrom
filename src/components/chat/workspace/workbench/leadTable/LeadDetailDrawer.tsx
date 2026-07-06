import { useEffect } from 'react';
import { X, ExternalLink, Building2, User, Sparkles, Mail, FileText, Activity, Code2, Search, Users } from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import { ContactStatusChip, RowStatusChip } from './StatusChip';

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
  const enrichLocked = row.enrichment_status !== 'enriched';
  const draftLocked = row.draft_status !== 'drafted' && row.draft_status !== 'approved';
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

        <Section icon={Building2} title="Company">
          <Field k="Name" v={row.company_name} />
          <Field k="Website" v={row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">{row.website}<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
          <Field k="Location" v={row.company_location} />
          <Field k="Status" v={<RowStatusChip value={row.status} />} />
        </Section>

        <Section icon={Sparkles} title="Signal">
          <Field k="Type" v={row.signal_type} />
          <Field k="Why" v={row.signal_summary} />
          <Field k="Source" v={row.signal_source_url ? <a href={row.signal_source_url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">link<ExternalLink className="h-2.5 w-2.5" /></a> : null} />
          <Field k="Fit" v={typeof row.fit_score === 'number' ? `${row.fit_score}` : null} />
        </Section>

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

        <Section icon={User} title="Recommended contact">
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
            <div className="text-[11px] text-amber-200/80 italic">Locked — run "Research company context" to enrich.</div>
          ) : (
            <>
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
            <pre className="whitespace-pre-wrap text-[12px] text-[#C9D1D9] bg-white/[0.02] rounded p-2 border border-white/[0.06]">{row.personalized_message}</pre>
          )}
        </Section>

        <Section icon={Activity} title="Activity">
          <Field k="Status" v={row.status} />
          <Field k="Found via" v={row.found_via ?? 'exact'} />
        </Section>

        <Section icon={Code2} title="Raw source">
          <pre className="whitespace-pre-wrap text-[10.5px] text-[#7D8590] bg-black/40 rounded p-2 border border-white/[0.06] max-h-64 overflow-auto">
{JSON.stringify(row.raw ?? row, null, 2)}
          </pre>
        </Section>
      </aside>
    </div>
  );
}
