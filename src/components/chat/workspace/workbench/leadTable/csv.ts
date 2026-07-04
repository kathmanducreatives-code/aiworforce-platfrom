import type { LeadTableRow } from '@/hooks/useLeadResults';

const LOCKED = 'Locked — not generated';

function esc(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function rowsToCsv(rows: LeadTableRow[]): string {
  const headers = [
    'company', 'website', 'location', 'signal_type',
    // Lead Intelligence Engine hiring-signal proof + quality columns.
    'job_title', 'exact_hiring_signal', 'source_url', 'source_quality',
    // Preserved Apify LinkedIn-Jobs source data.
    'domain', 'company_linkedin_url', 'job_url', 'company_description', 'job_description',
    'industries', 'employee_count',
    'poster_contact_hint_name', 'poster_contact_hint_profile_url', 'poster_contact_hint_title',
    // Source-specific proof — populated per signal source (people / company /
    // posts / comments / workflow trends); blank when N/A for the row's source.
    'person_name', 'profile_url',
    'post_url', 'author_name', 'post_snippet',
    'comment_text', 'commenter_name', 'competitor_mentioned',
    'workflow_title', 'tools_mentioned', 'workflow_steps',
    'fit_score', 'fit_tier', 'why_this_lead', 'matched_icp', 'missing_fields',
    // Aria explainable score (Company-Brain-first analyst view).
    'overall_fit', 'star_tier', 'confidence_level', 'competitor_similarity', 'why_accepted',
    // Proof-gate outcome (Phase 3).
    'gate_decision', 'final_overall_fit', 'gate_reasons', 'missing_evidence', 'disqualifiers_hit',
    'decision_maker_status', 'enrichment_status', 'next_action',
    'signal_summary', 'recommended_persona', 'contact_status',
    'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
    'enrichment_summary', 'personalized_message', 'status',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const contactLocked = r.contact_status === 'needs_contact';
    const enrichLocked = r.enrichment_status !== 'enriched';
    const draftLocked = r.draft_status !== 'drafted' && r.draft_status !== 'approved';
    const raw = (r.raw && typeof r.raw === 'object' ? r.raw : {}) as Record<string, unknown>;
    const arr = (v: unknown) => Array.isArray(v) ? (v as unknown[]).join(' · ') : (v ?? '');
    // Prefer real source proof (job_url / company website); never emit a fake
    // proof_incomplete URL — an empty cell + source_quality tells the honest story.
    const sourceUrl = (raw.source_url as string) || (raw.job_url as string) || (raw.company_website as string) || r.website || '';
    const poster = (raw.poster_contact_hint && typeof raw.poster_contact_hint === 'object' ? raw.poster_contact_hint : {}) as Record<string, unknown>;
    lines.push([
      esc(r.company_name),
      esc(r.website || raw.company_website || raw.website),
      esc(r.company_location),
      esc(r.signal_type),
      esc(raw.job_title),
      esc(raw.exact_hiring_signal),
      esc(sourceUrl),
      esc(raw.source_quality),
      esc(raw.domain),
      esc(raw.company_linkedin_url),
      esc(raw.job_url),
      esc(raw.company_description),
      esc(raw.job_description),
      esc(arr(raw.industries)),
      esc(raw.employee_count),
      esc(poster.name),
      esc(poster.profile_url),
      esc(poster.title),
      // Source-specific proof (mirrors the gate-accepted raw fields).
      esc(raw.person_name),
      esc(raw.profile_url),
      esc(raw.post_url),
      esc(raw.author_name),
      esc(raw.post_snippet),
      esc(raw.comment_text),
      esc(raw.commenter_name),
      esc(raw.competitor_mentioned),
      esc(raw.workflow_title),
      esc(arr(raw.tools_mentioned)),
      esc(arr(raw.workflow_steps)),
      esc(r.fit_score),
      esc(raw.fit_tier),
      esc(raw.why_this_lead),
      esc(arr(raw.matched_icp)),
      esc(arr(raw.missing_fields)),
      // Aria explainable score.
      esc(raw.overall_fit),
      esc(raw.star_tier),
      esc(raw.confidence_level),
      esc(raw.competitor_similarity),
      esc(arr(raw.why_accepted)),
      // Proof-gate outcome (empty for legacy rows).
      esc(raw.gate_decision),
      esc(raw.final_overall_fit ?? raw.overall_fit),
      esc(arr(raw.gate_reasons)),
      esc(arr(raw.missing_evidence)),
      esc(arr(raw.disqualifiers_hit)),
      esc(r.contact_status === 'needs_contact' ? 'missing' : (r.contact_status ?? 'missing')),
      esc(r.enrichment_status),
      esc((raw.next_action as string) ?? ''),
      esc(r.signal_summary),
      esc(r.recommended_persona),
      esc(r.contact_status),
      esc(contactLocked ? LOCKED : r.contact_name),
      esc(contactLocked ? LOCKED : r.contact_title),
      esc(contactLocked ? LOCKED : r.contact_email),
      esc(contactLocked ? LOCKED : r.contact_linkedin_url),
      esc(enrichLocked ? LOCKED : r.enrichment_summary),
      esc(draftLocked ? LOCKED : r.personalized_message),
      esc(r.status),
    ].join(','));
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
