import type { LeadTableRow } from '@/hooks/useLeadResults';
import { unwrapLeadRaw } from '@/lib/leadRowAction';
import { hydrateOutreachStage, OUTREACH_DRAFT_READY_COPY } from '@/lib/outreachStageView';

// "Locked" only means the user has not run the unlock action yet. After running,
// the persisted status tells the real story (Part F).
const NOT_GENERATED = 'Not generated';

function esc(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function rowsToCsv(rows: LeadTableRow[]): string {
  const headers = [
    'company', 'website', 'domain', 'company_linkedin_url', 'company_logo', 'company_slogan',
    'company_description', 'industries', 'employee_count', 'location',
    'address_country', 'address_region', 'address_locality',
    'signal_type',
    // Lead Intelligence Engine hiring-signal proof + quality columns.
    'job_title', 'exact_hiring_signal', 'job_url', 'apply_url', 'job_description_excerpt',
    'employment_type', 'seniority_level', 'job_function', 'salary', 'posted_at', 'applicants_count',
    'source_url', 'source_quality',
    // Poster hint (from the job post — not a verified buyer).
    'job_poster_name', 'job_poster_profile_url', 'job_poster_photo', 'job_poster_title',
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
    // Analyst brief + Scout pre-rank (analyst-quality Workbench).
    'analyst_verdict', 'scout_rank', 'scout_pre_rank_score', 'scout_rank_reasons', 'scout_penalties',
    'why_now', 'icp_fit_summary', 'evidence_summary', 'risk_flags', 'recommended_next_action', 'outreach_angle',
    'decision_maker_status', 'enrichment_status', 'next_action',
    'signal_summary', 'recommended_persona', 'contact_status',
    'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
    'enrichment_summary', 'personalized_message', 'status',
    // Provider/debug identifiers.
    'provider_job_id', 'provider_ref_id', 'tracking_id', 'input_url',
    'outreach_status',
    // Canonical personalized-opener metadata. Never prompts, provider payloads
    // or model traces — only what a human needs to judge the draft.
    'approval_status', 'personalization_depth',
    'selected_recipient_name', 'selected_recipient_title',
    'generated_at', 'evidence_count',
    // Query trace + explainability (Parts 1/3/7) — trace every row back to the
    // exact run + query that produced it, and why it was accepted/downgraded/flagged.
    'run_id', 'original_user_query', 'parsed_intent_summary',
    'provider_query_keywords', 'provider_query_location',
    'intent_tier', 'relaxation_step_used', 'match_tier',
    'funding_required', 'funding_proof_found', 'funding_source_url',
    'recruiter_proxy', 'rejected_or_risk_reason',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const contactLocked = r.contact_status === 'needs_contact';
    const enrichLocked = r.enrichment_status !== 'enriched';
    const draftLocked = r.draft_status !== 'drafted' && r.draft_status !== 'approved';
    // useLeadResults sets row.raw to the full DB row; the preserved provider +
    // analyst payload is the jsonb one level deeper. Unwrap it so source-specific
    // proof columns (people/posts/comments/workflow) read the right object.
    const raw = unwrapLeadRaw(r.raw);
    // Honest per-field status (Part F): show the real outcome once run, not "locked".
    const dmStatus = (raw.decision_maker_status as string) ?? '';
    const contactState = contactLocked
      ? (dmStatus === 'needs_manual_review' ? 'No verified decision-maker found' : NOT_GENERATED)
      : null;
    const enrichState = enrichLocked
      ? (raw.company_enrichment ? String((raw.company_enrichment as Record<string, unknown>).status ?? 'needs_verification')
        : (r.domain_status === 'missing' ? 'Blocked: no website' : NOT_GENERATED))
      : 'Enriched';
    // CANONICAL outreach state. The personalized-opener path persists to
    // `raw.agentory_workbench.outreach.last_success` and writes NO legacy
    // `personalized_message` / full_draft row — so reading the legacy field
    // alone exported "Not generated" for openers that had actually been
    // generated, validated and persisted.
    const persistedOpener = hydrateOutreachStage(raw).last_success;

    // Recipient the opener was written for. The opener payload carries it when
    // the backend recorded one; otherwise fall back to the highest-ranked
    // verified person already exported in the contact_* columns.
    const primaryRecipient = (() => {
      const people = Array.isArray(raw.decision_makers) ? raw.decision_makers : [];
      const verified = people
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .filter((p) => p.verification_status === 'verified')
        .sort((a, b) => (typeof a.rank === 'number' ? a.rank : Number.MAX_SAFE_INTEGER)
          - (typeof b.rank === 'number' ? b.rank : Number.MAX_SAFE_INTEGER));
      const top = verified[0];
      if (!top) return null;
      return {
        full_name: typeof top.full_name === 'string' ? top.full_name : (typeof top.name === 'string' ? top.name : undefined),
        current_title: typeof top.current_title === 'string' ? top.current_title : (typeof top.title === 'string' ? top.title : undefined),
      };
    })();

    const outreachState = persistedOpener?.opener
      ? OUTREACH_DRAFT_READY_COPY
      : (draftLocked
        ? (r.contact_status === 'needs_contact' ? 'Insufficient context: no verified contact' : NOT_GENERATED)
        : OUTREACH_DRAFT_READY_COPY);

    // Legacy full_draft body is FALLBACK ONLY, for records that predate the
    // namespaced outreach stage.
    const personalizedMessage = persistedOpener?.opener
      ?? (draftLocked ? outreachState : (r.personalized_message ?? outreachState));
    const arr = (v: unknown) => Array.isArray(v) ? (v as unknown[]).join(' · ') : (v ?? '');
    const addr = (raw.company_address && typeof raw.company_address === 'object' ? raw.company_address : {}) as Record<string, unknown>;
    // Prefer real source proof (job_url / company website); never emit a fake
    // proof_incomplete URL — an empty cell + source_quality tells the honest story.
    const sourceUrl = r.signal_source_url || r.job_url || (raw.source_url as string) || r.website || '';
    const jobExcerpt = r.job_description ? String(r.job_description).slice(0, 300) : '';
    // Parts 1/3/6/7 — one honest "why not / why risky" cell: first available of
    // an explicit recorded reason → recruiter proxy → risk flags → gate rejects.
    const gateRejected = !!r.gate_decision && /reject/i.test(String(r.gate_decision));
    const rejectedOrRiskReason = [
      (raw.rejected_or_risk_reason as string) || '',
      raw.recruiter_proxy ? ((raw.recruiter_proxy_reason as string) || 'Recruiter/staffing proxy; actual hiring company hidden.') : '',
      Array.isArray(r.risk_flags) && r.risk_flags.length ? (r.risk_flags as unknown[]).join(' · ') : '',
      gateRejected && Array.isArray(raw.gate_reasons) && (raw.gate_reasons as unknown[]).length ? (raw.gate_reasons as unknown[]).join(' · ') : '',
    ].find((x) => x) ?? '';
    lines.push([
      esc(r.company_name),
      esc(r.website),
      esc((raw.domain as string) ?? ''),
      esc(r.company_linkedin_url),
      esc(r.company_logo),
      esc(r.company_slogan),
      esc(r.company_description),
      esc(arr(r.industries)),
      esc(r.employee_count),
      esc(r.company_location),
      esc(addr.country),
      esc(addr.region),
      esc(addr.locality),
      esc(r.signal_type),
      esc(r.job_title),
      esc(raw.exact_hiring_signal),
      esc(r.job_url),
      esc(r.apply_url),
      esc(jobExcerpt),
      esc(r.employment_type),
      esc(r.seniority_level),
      esc(r.job_function),
      esc(r.salary),
      esc(r.posted_at),
      esc(r.applicants_count),
      esc(sourceUrl),
      esc(r.source_quality),
      // Poster hint.
      esc(r.poster_name),
      esc(r.poster_profile_url),
      esc(r.poster_photo),
      esc(r.poster_title),
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
      esc(r.fit_tier),
      esc(r.why_this_lead),
      esc(arr(r.matched_icp)),
      esc(arr(r.missing_fields)),
      // Aria explainable score.
      esc(raw.overall_fit),
      esc(raw.star_tier),
      esc(r.confidence_level),
      esc(raw.competitor_similarity),
      esc(arr(raw.why_accepted)),
      // Proof-gate outcome (empty for legacy rows).
      esc(r.gate_decision),
      esc(r.final_overall_fit ?? raw.final_overall_fit ?? raw.overall_fit),
      esc(arr(raw.gate_reasons)),
      esc(arr(r.missing_evidence)),
      esc(arr(r.disqualifiers_hit)),
      esc(r.analyst_verdict),
      esc(raw.scout_rank),
      esc(raw.scout_pre_rank_score),
      esc(arr(raw.scout_rank_reasons)),
      esc(arr(raw.scout_penalties)),
      esc(r.why_now),
      esc(r.icp_fit_summary),
      esc(r.evidence_summary),
      esc(arr(r.risk_flags)),
      esc(r.recommended_next_action),
      esc(r.outreach_angle),
      esc(r.contact_status === 'needs_contact' ? 'missing' : (r.contact_status ?? 'missing')),
      esc(r.enrichment_status),
      esc((raw.next_action as string) ?? ''),
      esc(r.signal_summary),
      esc(r.recommended_persona),
      esc(r.contact_status),
      esc(contactState ?? r.contact_name),
      esc(contactState ?? r.contact_title),
      esc(contactState ?? r.contact_email),
      esc(contactState ?? r.contact_linkedin_url),
      esc(enrichLocked ? enrichState : (r.enrichment_summary ?? enrichState)),
      esc(personalizedMessage),
      esc(r.status),
      // Provider/debug identifiers.
      esc(raw.provider_job_id),
      esc(raw.provider_ref_id),
      esc(raw.provider_tracking_id),
      esc(raw.input_url),
      esc(outreachState),
      esc(persistedOpener?.approval_status),
      esc(persistedOpener?.personalization_depth),
      esc(persistedOpener?.selected_recipient_name ?? primaryRecipient?.full_name),
      esc(persistedOpener?.selected_recipient_title ?? primaryRecipient?.current_title),
      esc(persistedOpener?.generated_at),
      esc(persistedOpener ? (persistedOpener.used_evidence_ids?.length ?? 0) : ''),
      // Query trace + explainability (Parts 1/3/7).
      esc(raw.run_id),
      esc(raw.original_user_query),
      esc(raw.parsed_intent_summary),
      esc(raw.provider_query_keywords),
      esc(raw.provider_query_location),
      esc(raw.intent_tier),
      esc(raw.relaxation_step_used),
      esc(raw.match_tier),
      esc(raw.funding_required),
      esc(raw.funding_proof_found),
      esc(raw.funding_source_url),
      esc(raw.recruiter_proxy ? 'yes' : ''),
      esc(rejectedOrRiskReason),
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
