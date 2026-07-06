import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ContactStatus = 'needs_contact' | 'profile_found' | 'email_found' | 'verified';
export type EnrichmentStatus = 'locked' | 'not_started' | 'enrichable' | 'enriched' | 'failed';
export type DraftStatus = 'locked' | 'blocked_missing_contact' | 'ready' | 'drafted' | 'approved';
export type DomainStatus = 'missing' | 'probable' | 'confirmed';

export interface LeadTableRow {
  id: string;
  lead_candidate_id: string;
  account_id?: string | null;
  contact_id?: string | null;
  signal_id?: string | null;

  company_name?: string | null;
  company_location?: string | null;
  website?: string | null;
  domain_status: DomainStatus;

  signal_type?: string | null;
  signal_title?: string | null;
  signal_summary?: string | null;
  signal_source_url?: string | null;
  found_via?: string | null;

  recommended_persona?: string | null;
  recommended_persona_reason?: string | null;

  contact_name?: string | null;
  contact_title?: string | null;
  contact_linkedin_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_status: ContactStatus;

  fit_score?: number | null;
  fit_reason?: string | null;
  fit_tier?: string | null;
  why_this_lead?: string | null;
  matched_icp?: string[];
  missing_fields?: string[];

  // Company evidence preserved from the Apify LinkedIn-Jobs scraper.
  company_linkedin_url?: string | null;
  company_logo?: string | null;
  company_slogan?: string | null;
  company_description?: string | null;
  industries?: string[];
  employee_count?: number | null;

  // Hiring-signal / job evidence.
  job_title?: string | null;
  job_url?: string | null;
  apply_url?: string | null;
  job_description?: string | null;
  employment_type?: string | null;
  seniority_level?: string | null;
  job_function?: string | null;
  salary?: string | null;
  posted_at?: string | null;
  applicants_count?: number | null;
  source_quality?: string | null;

  // Poster contact hint (from the job post — NOT a verified decision-maker).
  poster_name?: string | null;
  poster_profile_url?: string | null;
  poster_title?: string | null;
  poster_photo?: string | null;

  // Analyst brief (Aria + proof gate + analyst summary).
  analyst_verdict?: string | null;
  final_overall_fit?: number | null;
  confidence_level?: string | null;
  gate_decision?: string | null;
  why_now?: string | null;
  icp_fit_summary?: string | null;
  evidence_summary?: string | null;
  missing_evidence?: string[];
  risk_flags?: string[];
  disqualifiers_hit?: string[];
  recommended_next_action?: string | null;
  outreach_angle?: string | null;

  enrichment_status: EnrichmentStatus;
  enrichment_summary?: string | null;
  personalization_angles?: string[];

  draft_status: DraftStatus;
  personalized_message?: string | null;
  draft_id?: string | null;

  status: string;
  raw?: unknown;
}

/** Legacy shape kept for backward compatibility with the old card view. */
export interface LeadResultItem extends LeadTableRow {
  source_url?: string | null;
  source_type?: string | null;
  location?: string | null;
}

function inferPersona(leadType: string | null | undefined): { persona: string | null; reason: string | null } {
  const t = (leadType ?? '').toLowerCase();
  if (t.includes('hiring')) return { persona: 'Head of Talent', reason: 'Hiring signal — talent leader owns this decision.' };
  if (t.includes('founder') || t.includes('pain')) return { persona: 'Founder / CEO', reason: 'Founder-pain signal — escalate directly.' };
  if (t.includes('linkedin') || t.includes('engagement')) return { persona: 'VP Marketing', reason: 'Engagement signal — marketing owns top-of-funnel.' };
  if (t.includes('growth')) return { persona: 'Head of Growth', reason: 'Growth signal — growth leader is the right entry.' };
  return { persona: null, reason: null };
}

export function useLeadResults(planId: string | null) {
  const [items, setItems] = useState<LeadTableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('lead_candidates' as any)
        .select(
          'id, plan_id, lead_type, status, fit_score, priority, reason, raw, account_id, contact_id, ' +
          'accounts(id,name,domain,industry,stage), contacts(id,full_name,title,linkedin_url,email)',
        )
        .eq('plan_id', planId)
        .order('priority', { ascending: false });
      if (err) throw err;
      const rows = (data ?? []) as any[];
      const ids = rows.map((r) => r.id);
      const accountIds = rows.map((r) => r.account_id).filter(Boolean);

      // Best-effort enrichment + draft joins. Either may fail silently.
      let enrichByLead = new Map<string, any>();
      let enrichByAccount = new Map<string, any>();
      let draftByLead = new Map<string, any>();
      try {
        if (ids.length) {
          const { data: enr } = await supabase
            .from('lead_enrichments' as any)
            .select('id, lead_candidate_id, account_id, status, summary, personalization_angles')
            .or(`lead_candidate_id.in.(${ids.join(',')})${accountIds.length ? `,account_id.in.(${accountIds.join(',')})` : ''}`);
          for (const e of (enr ?? []) as any[]) {
            if (e.lead_candidate_id) enrichByLead.set(e.lead_candidate_id, e);
            if (e.account_id) enrichByAccount.set(e.account_id, e);
          }
        }
      } catch { /* table may not exist or be denied */ }
      try {
        if (ids.length) {
          const { data: dr } = await supabase
            .from('outreach_drafts' as any)
            .select('id, lead_candidate_id, status, body, channel')
            .in('lead_candidate_id', ids);
          for (const d of (dr ?? []) as any[]) {
            if (d.lead_candidate_id) draftByLead.set(d.lead_candidate_id, d);
          }
        }
      } catch { /* ignore */ }

      const normalized: LeadTableRow[] = rows.map((r) => {
        // lead-quality metadata persisted by run-agent (fit_tier, why_this_lead,
        // matched_icp, missing_fields) lives on the raw jsonb.
        const rawMeta = (r.raw && typeof r.raw === 'object') ? r.raw as Record<string, any> : {};
        // Website: prefer the account domain, then the preserved company website
        // from the Apify jobs scraper (raw.company_website) so a real website is
        // shown instead of "no website" when the domain wasn't parsed.
        const domain = (r.accounts?.domain as string | undefined) || (rawMeta.domain as string | undefined) || undefined;
        const rawWebsite = (rawMeta.company_website ?? rawMeta.website) as string | undefined;
        const website = domain
          ? (domain.startsWith('http') ? domain : `https://${domain}`)
          : (rawWebsite ?? null);
        const domain_status: DomainStatus = (domain || rawWebsite) ? 'confirmed' : 'missing';
        const contactEmail = r.contacts?.email ?? null;
        const contactLinkedin = r.contacts?.linkedin_url ?? null;
        const contact_status: ContactStatus =
          contactEmail ? 'email_found'
          : contactLinkedin || r.contact_id ? 'profile_found'
          : 'needs_contact';
        const enr = enrichByLead.get(r.id) ?? (r.account_id ? enrichByAccount.get(r.account_id) : null);
        const enrichment_status: EnrichmentStatus =
          enr ? 'enriched' : (website ? 'enrichable' : 'not_started');
        const draft = draftByLead.get(r.id);
        const draft_status: DraftStatus =
          draft ? (draft.status === 'approved' ? 'approved' : 'drafted')
          : (contact_status === 'needs_contact' ? 'blocked_missing_contact' : 'ready');
        const persona = inferPersona(r.lead_type);

        // Read helpers for the preserved Apify + analyst jsonb (never fabricate).
        const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
        const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const a = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
        const poster = (rawMeta.poster_contact_hint && typeof rawMeta.poster_contact_hint === 'object')
          ? rawMeta.poster_contact_hint as Record<string, any> : {};
        const addr = (rawMeta.company_address && typeof rawMeta.company_address === 'object')
          ? rawMeta.company_address as Record<string, any> : {};
        const companyLocation = s(rawMeta.location)
          ?? ([s(addr.locality), s(addr.region), s(addr.country)].filter(Boolean).join(', ') || null);
        const sourceUrl = s(rawMeta.source_url) ?? s(rawMeta.job_url) ?? s(rawMeta.company_website) ?? null;

        return {
          id: r.id,
          lead_candidate_id: r.id,
          account_id: r.account_id ?? null,
          contact_id: r.contact_id ?? null,
          signal_id: null,
          company_name: r.accounts?.name ?? null,
          company_location: companyLocation,
          website,
          domain_status,
          signal_type: r.lead_type ?? null,
          signal_title: r.lead_type ?? null,
          signal_summary: s(rawMeta.signal_summary) ?? r.reason ?? null,
          signal_source_url: sourceUrl,
          found_via: null,
          recommended_persona: persona.persona,
          recommended_persona_reason: persona.reason,
          contact_name: r.contacts?.full_name ?? null,
          contact_title: r.contacts?.title ?? null,
          contact_linkedin_url: contactLinkedin,
          contact_email: contactEmail,
          contact_phone: null,
          contact_status,
          fit_score: typeof r.fit_score === 'number' ? r.fit_score : null,
          fit_reason: r.reason ?? null,
          fit_tier: typeof rawMeta.fit_tier === 'string' ? rawMeta.fit_tier : null,
          why_this_lead: typeof rawMeta.why_this_lead === 'string' ? rawMeta.why_this_lead : null,
          matched_icp: Array.isArray(rawMeta.matched_icp) ? rawMeta.matched_icp : [],
          missing_fields: Array.isArray(rawMeta.missing_fields) ? rawMeta.missing_fields : [],
          // Company evidence.
          company_linkedin_url: s(rawMeta.company_linkedin_url),
          company_logo: s(rawMeta.company_logo),
          company_slogan: s(rawMeta.company_slogan),
          company_description: s(rawMeta.company_description),
          industries: a(rawMeta.industries),
          employee_count: n(rawMeta.employee_count),
          // Job evidence.
          job_title: s(rawMeta.job_title),
          job_url: s(rawMeta.job_url),
          apply_url: s(rawMeta.apply_url),
          job_description: s(rawMeta.job_description),
          employment_type: s(rawMeta.employment_type),
          seniority_level: s(rawMeta.seniority_level),
          job_function: s(rawMeta.job_function),
          salary: s(rawMeta.salary),
          posted_at: s(rawMeta.posted_at),
          applicants_count: n(rawMeta.applicants_count),
          source_quality: s(rawMeta.source_quality),
          // Poster hint (job post author — not a verified buyer).
          poster_name: s(poster.name),
          poster_profile_url: s(poster.profile_url),
          poster_title: s(poster.title),
          poster_photo: s(poster.photo),
          // Analyst brief.
          analyst_verdict: s(rawMeta.analyst_verdict),
          final_overall_fit: n(rawMeta.final_overall_fit) ?? n(rawMeta.overall_fit),
          confidence_level: s(rawMeta.confidence_level),
          gate_decision: s(rawMeta.gate_decision),
          why_now: s(rawMeta.why_now),
          icp_fit_summary: s(rawMeta.icp_fit_summary),
          evidence_summary: s(rawMeta.evidence_summary),
          missing_evidence: a(rawMeta.missing_evidence),
          risk_flags: a(rawMeta.risk_flags),
          disqualifiers_hit: a(rawMeta.disqualifiers_hit),
          recommended_next_action: s(rawMeta.recommended_next_action),
          outreach_angle: s(rawMeta.outreach_angle),
          enrichment_status,
          enrichment_summary: enr?.summary ?? null,
          personalization_angles: Array.isArray(enr?.personalization_angles) ? enr.personalization_angles : [],
          draft_status,
          personalized_message: draft?.body ?? null,
          draft_id: draft?.id ?? null,
          status: r.status ?? 'new',
          raw: r,
        };
      });
      setItems(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lead results');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { void load(); }, [load]);

  return { items, loading, error, refresh: load };
}
