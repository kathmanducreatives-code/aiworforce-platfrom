import { describe, it, expect } from 'vitest';
import type { AccountResearchSnapshot } from '@/lib/accountResearchHydration';
import type { IcpSnapshot, SavedIcp, WhyRelevant } from '@/lib/icpSnapshot';
import type { DisplayDecisionMaker } from '@/lib/decisionMakerDisplay';
import {
  buildPersonalizationContext,
  assessOpenerEligibility,
  generateOpener,
  validateOpener,
  buildOutreachStagePayload,
  brainContextFromProfile,
  buildOutreachRowHint,
  openerBlockerCopy,
  countWords,
  DEFAULT_OPENER_CONSTRAINTS,
  OPENER_OUTPUT_MODE,
  type CompanyBrainContext,
  type ModelBoundary,
  type PersonalizationContext,
  type OpenerEligibility,
} from '@/lib/outreachOpener';

// ---- synthetic fixtures (no real customer data, no raw payloads) -------------

const brain: CompanyBrainContext = {
  present: true,
  positioning: 'We help GTM teams qualify accounts before scaling outreach.',
  product_summary: 'Account qualification workspace',
  target_outcomes: ['build qualified pipeline before adding sales headcount'],
  differentiators: ['evidence-first qualification'],
  prohibited_claims: ['guaranteed meetings'],
  tone: 'calm, founder-to-founder',
  approved_ctas: ['worth a quick look?'],
};

function snapshot(over: Partial<AccountResearchSnapshot> = {}): AccountResearchSnapshot {
  return {
    lead_candidate_id: 'lc-1',
    status: 'available',
    origin: 'combined',
    company_identity: { name: 'Acme', domain: 'acme.example', website: 'https://acme.example', company_linkedin_url: 'https://linkedin.com/company/acme' },
    overview: { summary: 'Acme builds warehouse automation for logistics teams.', industry: 'B2B SaaS', category: 'Robotics', employee_range: '51–200', location: 'US' },
    hiring_signal: { title: 'Revenue Operations Associate', job_url: 'https://boards.example/acme/revops', posted_at: '2026-07-15', why_now: 'Hiring RevOps' },
    qualification_context: { sourcing_fit_score: 82, sourcing_verdict: 'qualified', why_selected: 'industry+size', why_now: 'Hiring RevOps', gate: 'accept', confidence: 'high', disqualifiers: [] },
    evidence: [
      { url: 'https://acme.example', kind: 'website', label: 'Company website' },
      { url: 'https://linkedin.com/company/acme', kind: 'company_linkedin', label: 'Company LinkedIn' },
      { url: 'https://boards.example/acme/revops', kind: 'job_posting', label: 'Hiring signal (job posting)' },
    ],
    source_count: 3,
    confidence: 'high',
    missing_evidence: [],
    refreshed_at: '2026-07-15T00:00:00.000Z',
    stale_after: '2026-08-14T00:00:00.000Z',
    ...over,
  };
}

function icp(over: Partial<IcpSnapshot> = {}): IcpSnapshot {
  return {
    status: 'moderate_fit',
    company_fit: { status: 'supported', reasons: ['Target industry', 'Company size band'], evidence_ids: [] },
    buyer_fit: { status: 'verified', reasons: ['Verified buyer'] },
    buying_moment_fit: { status: 'supported', reason: 'Hiring RevOps', evidence_ids: [] },
    matched_criteria: [{ criterion: 'Industry', reason: 'x', evidence_ids: [] }, { criterion: 'Company size', reason: 'y', evidence_ids: [] }],
    missing_criteria: [],
    disqualifiers: [],
    confidence: 'medium',
    uses_saved_icp: true,
    icp_completeness: { defined: ['industries', 'company_size'], undefined_criteria: [], complete: true },
    ...over,
  };
}

const savedIcp: SavedIcp = { industries: ['B2B SaaS'], company_size: ['51–200'], buyer_roles: ['Revenue Operations'], disqualifiers: ['staffing agency'] };

function dm(over: Partial<DisplayDecisionMaker> = {}): DisplayDecisionMaker {
  return { full_name: 'Sarah Lee', first_name: 'Sarah', current_title: 'VP Revenue Operations', current_company_name: 'Acme', role_family: 'Revenue Operations', verification_status: 'verified', verification_methods: ['company_linkedin_match'], ...over } as DisplayDecisionMaker;
}

const whyRelevant = (over: Partial<WhyRelevant> = {}): WhyRelevant => ({ why_this_company: 'Matches saved industry and size', why_this_person: 'Verified RevOps buyer', why_now: 'Hiring RevOps', support_level: 'specific', ...over });

function ctxFor(opts: { snap?: AccountResearchSnapshot; icpSnap?: IcpSnapshot; brainCtx?: CompanyBrainContext; person?: DisplayDecisionMaker | null; wr?: WhyRelevant } = {}): PersonalizationContext {
  return buildPersonalizationContext({
    snapshot: opts.snap ?? snapshot(),
    icp_snapshot: opts.icpSnap ?? icp(),
    saved_icp: savedIcp,
    brain: opts.brainCtx ?? brain,
    decision_maker: opts.person === undefined ? dm() : opts.person,
    why_relevant: opts.wr ?? whyRelevant(),
  });
}

// A deterministic model stub — NEVER a real model.
const stubModel = (opener: string, alt?: string): ModelBoundary => async () => ({ opener, alternative_opener: alt, used_evidence_ids: ['ev_3_job_posting'] });

// ---- CONTEXT -----------------------------------------------------------------

describe('context', () => {
  it('loads saved ICP, brain, research, verified decision-maker, timing', () => {
    const ctx = ctxFor();
    expect(ctx.saved_icp?.industries).toEqual(['B2B SaaS']);
    expect(ctx.company_brain.present).toBe(true);
    expect(ctx.company.summary).toContain('Acme builds');
    expect(ctx.decision_maker?.verification_status).toBe('verified');
    expect(ctx.evidence.some((e) => e.source_type === 'job_posting' && e.freshness === 'fresh')).toBe(true);
  });
  it('excludes raw pages / provider payloads (only sanitized labels + urls)', () => {
    const ctx = ctxFor();
    const flat = JSON.stringify(ctx);
    expect(flat).not.toMatch(/<html|<!doctype|"raw"|provider_payload/i);
    // evidence carries a short claim label, not page text.
    expect(ctx.evidence.every((e) => e.claim.length < 60)).toBe(true);
  });
});

// ---- ELIGIBILITY -------------------------------------------------------------

describe('eligibility', () => {
  it('verified person + research + brain + fresh signal + ICP → ready/specific', () => {
    const e = assessOpenerEligibility(ctxFor(), icp());
    expect(e.status).toBe('ready');
    expect(e.personalization_depth).toBe('specific');
  });
  it('no person → blocked_missing_verified_person', () => {
    const e = assessOpenerEligibility(ctxFor({ person: null }), icp());
    expect(e.reason_code).toBe('blocked_missing_verified_person');
  });
  it('no brain → blocked_missing_company_brain', () => {
    const e = assessOpenerEligibility(ctxFor({ brainCtx: { ...brain, present: false } }), icp());
    expect(e.reason_code).toBe('blocked_missing_company_brain');
  });
  it('no research → blocked_missing_company_research', () => {
    const snap = snapshot({ status: 'missing', overview: { summary: null, industry: null, category: null, employee_range: null, location: null }, evidence: [], source_count: 0 });
    const e = assessOpenerEligibility(ctxFor({ snap }), icp());
    expect(e.reason_code).toBe('blocked_missing_company_research');
  });
  it('ICP disqualifier → blocked_icp_disqualified (overrides positives)', () => {
    const e = assessOpenerEligibility(ctxFor(), icp({ status: 'excluded' }));
    expect(e.reason_code).toBe('blocked_icp_disqualified');
  });
  it('no timing signal → company_level, NOT blocked', () => {
    const snap = snapshot({ status: 'available', hiring_signal: null, evidence: [{ url: 'https://acme.example', kind: 'website', label: 'Company website' }], source_count: 1 });
    const e = assessOpenerEligibility(ctxFor({ snap }), icp({ buying_moment_fit: { status: 'missing', reason: 'none', evidence_ids: [] } }));
    expect(e.status).toBe('ready');
    expect(e.personalization_depth).toBe('company_level');
  });
});

// ---- GENERATION --------------------------------------------------------------

const GOOD_OPENER = 'Sarah — saw Acme is hiring for Revenue Operations; tightening how accounts are qualified before adding outreach may be especially relevant right now.';

describe('generation', () => {
  it('produces one opener within limits, approval required, not sent', async () => {
    const r = await generateOpener(ctxFor(), assessOpenerEligibility(ctxFor(), icp()), stubModel(GOOD_OPENER));
    expect(r.status).toBe('succeeded');
    expect(r.opener).toBe(GOOD_OPENER);
    expect(r.approval_required).toBe(true);
    expect(r.sent).toBe(false);
    expect(r.opener!.length).toBeLessThanOrEqual(240);
    expect(countWords(r.opener!)).toBeGreaterThanOrEqual(18);
    expect(r.used_evidence_ids).toContain('ev_3_job_posting');
  });
  it('blocked eligibility makes NO model call', async () => {
    let called = false;
    const model: ModelBoundary = async () => { called = true; return { opener: 'x' }; };
    const elig: OpenerEligibility = { status: 'blocked', reason_code: 'blocked_missing_verified_person', personalization_depth: 'generic_value_only', allowed_evidence_ids: [], missing_requirements: [] };
    const r = await generateOpener(ctxFor(), elig, model);
    expect(called).toBe(false);
    expect(r.status).toBe('blocked');
    expect(r.provider_attempted).toBe(false);
  });
  it('accepts an optional alternative opener; drops an invalid one', async () => {
    const r = await generateOpener(ctxFor(), assessOpenerEligibility(ctxFor(), icp()), stubModel(GOOD_OPENER, 'Sarah — Acme’s logistics automation looks aligned with teams building qualified pipeline before adding sales headcount.'));
    expect(r.alternative_opener).toBeTruthy();
    const r2 = await generateOpener(ctxFor(), assessOpenerEligibility(ctxFor(), icp()), stubModel(GOOD_OPENER, 'Hope you are well!'));
    expect(r2.alternative_opener).toBeUndefined();
  });
});

// ---- CLAIM SAFETY + STYLE ----------------------------------------------------

describe('claim safety + style (validation rejects)', () => {
  const ctx = ctxFor();
  const elig = assessOpenerEligibility(ctx, icp());
  const rej = (t: string, ctxOver?: PersonalizationContext) => validateOpener(t, ctxOver ?? ctx, elig);

  it('rejects over-length / full-draft / multi-question', () => {
    expect(rej('a'.repeat(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars + 1)).length_valid).toBe(false);
    expect(rej('Subject: Hi\n\nDear Sarah, best regards').violations).toContain('looks_like_full_draft');
    expect(rej('Sarah — one? and two? really?').length_valid).toBe(false);
  });
  it('rejects invented funding when no funding evidence exists', () => {
    expect(rej('Sarah — congrats on Acme raising your Series B; qualification before scaling outreach may help.').no_fabrication).toBe(false);
  });
  it('rejects a hiring claim worded current when the signal is stale', () => {
    const staleCtx = ctxFor({ snap: snapshot({ status: 'stale', evidence: [{ url: 'https://boards.example/acme/revops', kind: 'job_posting', label: 'Hiring signal (job posting)' }], source_count: 1 }) });
    const staleElig = assessOpenerEligibility(staleCtx, icp());
    const v = validateOpener('Sarah — saw Acme is hiring for Revenue Operations right now; qualification may be relevant.', staleCtx, staleElig);
    expect(v.no_fabrication).toBe(false);
  });
  it('rejects prohibited phrases + brain prohibited claims + AI-SDR/replace-team/auto-send', () => {
    expect(rej('Sarah — I came across your profile and wanted to reach out about pipeline.').prohibited_claims_absent).toBe(false);
    expect(rej('Sarah — our AI SDR can 10x your pipeline and replace your sales team automatically.').prohibited_claims_absent).toBe(false);
    expect(rej('Sarah — we guaranteed meetings for teams like Acme building pipeline.').prohibited_claims_absent).toBe(false);
  });
  it('rejects fake familiarity / generic compliment', () => {
    expect(rej('Sarah — I noticed your impressive background and love what you are doing at Acme.').tone_valid).toBe(false);
  });
  it('accepts a calm, low-pressure, evidence-grounded opener', () => {
    const v = rej(GOOD_OPENER);
    expect(v.length_valid && v.tone_valid && v.prohibited_claims_absent && v.no_fabrication).toBe(true);
  });
});

// ---- PERSISTENCE -------------------------------------------------------------

describe('persistence (namespaced outreach stage)', () => {
  const ctx = ctxFor();
  const elig = assessOpenerEligibility(ctx, icp());
  it('uses explicit output_mode and never sets sent', async () => {
    const r = await generateOpener(ctx, elig, stubModel(GOOD_OPENER));
    const p = buildOutreachStagePayload(r, '2026-07-19T00:00:00.000Z');
    expect(p.output_mode).toBe(OPENER_OUTPUT_MODE);
    expect(p.sent).toBe(false);
    expect(p.approval_required).toBe(true);
    expect(p.approval_status).toBe('draft');
    expect(p.opener).toBe(GOOD_OPENER);
  });
  it('a failed retry preserves the previous valid opener', async () => {
    const good = buildOutreachStagePayload(await generateOpener(ctx, elig, stubModel(GOOD_OPENER)), '2026-07-19T00:00:00.000Z');
    const failed = await generateOpener(ctx, elig, stubModel('a'.repeat(DEFAULT_OPENER_CONSTRAINTS.hard_max_chars + 50))); // over cap → failed_validation
    const merged = buildOutreachStagePayload(failed, '2026-07-19T01:00:00.000Z', good);
    expect(merged.opener).toBe(GOOD_OPENER);       // previous opener kept
    expect(merged.status).toBe('failed_validation'); // new attempt status recorded
  });
});

// ---- PRESENTATION COPY -------------------------------------------------------

describe('brainContextFromProfile', () => {
  it('marks present and extracts outcomes/prohibited/tone (tolerant shapes)', () => {
    const b = brainContextFromProfile({ icp: { industries: ['SaaS'] }, product: { summary: 'X', outcomes: ['qualified pipeline'] }, voice: { tone: 'calm', avoid: ['guaranteed meetings'] } });
    expect(b.present).toBe(true);
    expect(b.target_outcomes).toContain('qualified pipeline');
    expect(b.prohibited_claims).toContain('guaranteed meetings');
    expect(b.tone).toBe('calm');
  });
  it('absent brain ⇒ present false', () => {
    expect(brainContextFromProfile(null).present).toBe(false);
    expect(brainContextFromProfile({}).present).toBe(false);
  });
});

describe('buildOutreachRowHint', () => {
  it('persisted opener ⇒ has_opener, no blocker', () => {
    const persisted = buildOutreachStagePayload({ status: 'succeeded', reason_code: 'ready', opener: GOOD_OPENER, personalization_depth: 'specific', used_evidence_ids: [], approval_required: true, sent: false, provider_attempted: true, omitted_claims: [] }, '2026-07-19T00:00:00Z');
    const h = buildOutreachRowHint({ eligibility: assessOpenerEligibility(ctxFor(), icp()), persisted, source_count: 3 });
    expect(h.status).toBe('has_opener');
    expect(h.opener).toBe(GOOD_OPENER);
    expect(h.blocker_copy).toBeNull();
  });
  it('blocked eligibility ⇒ specific blocker copy, no generic sentence', () => {
    const h = buildOutreachRowHint({ eligibility: assessOpenerEligibility(ctxFor({ person: null }), icp()), source_count: 3 });
    expect(h.status).toBe('blocked');
    expect(h.blocker_copy).toBe('Find a verified decision-maker first');
    expect(h.blocker_copy).not.toMatch(/required previous step/i);
  });
});

describe('blocker copy — specific, never generic', () => {
  it('maps each reason to specific copy', () => {
    expect(openerBlockerCopy('blocked_missing_verified_person')).toBe('Find a verified decision-maker first');
    expect(openerBlockerCopy('blocked_missing_company_brain')).toBe('Complete Company Brain first');
    expect(openerBlockerCopy('blocked_missing_company_research')).toBe('Add usable company research first');
    expect(openerBlockerCopy('blocked_icp_disqualified')).toBe('Account is excluded by your ICP');
    expect(openerBlockerCopy('something_unknown')).toBe('Outreach generation unavailable');
    expect(openerBlockerCopy(undefined)).not.toMatch(/required previous step/i);
  });
});
