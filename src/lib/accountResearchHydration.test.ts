import { describe, it, expect } from 'vitest';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { SavedIcp } from '@/lib/icpSnapshot';
import {
  hydrateAccountResearchSnapshot,
  researchViewFromSnapshot,
  hydrateAccountView,
  applyHydrationFloor,
  researchCta,
  hasUsableHydratedResearch,
  outreachReadiness,
  collectEvidence,
  readLeadJsonb,
  savedIcpFromBrain,
  RESEARCH_STALE_DAYS,
} from '@/lib/accountResearchHydration';
import { emptyAccountView, mergeWorkbenchStage } from '@/lib/workbenchAccountView';

const FIXED_NOW = Date.parse('2026-07-18T12:00:00.000Z');
const now = () => FIXED_NOW;
const recent = new Date(FIXED_NOW - 3 * 86_400_000).toISOString();
const old = new Date(FIXED_NOW - 90 * 86_400_000).toISOString();

/** A sourced account exactly like production plan 4156da64 (no real customer data). */
function sourcedRow(over: Partial<LeadTableRow> = {}, jsonb: Record<string, unknown> = {}): LeadTableRow {
  const base: LeadTableRow = {
    id: 'lc-1',
    lead_candidate_id: 'lc-1',
    domain_status: 'present' as never,
    contact_status: 'needs_contact' as never,
    enrichment_status: 'enriched' as never,
    draft_status: 'none' as never,
    status: 'new',
    company_name: 'Acme Robotics',
    company_location: 'San Francisco, CA',
    website: 'https://acme.example',
    company_linkedin_url: 'https://www.linkedin.com/company/acme',
    job_title: 'Revenue Operations Associate',
    job_url: 'https://boards.example/acme/revops-1',
    posted_at: recent,
    why_now: 'Hiring a Revenue Operations Associate',
    industries: ['B2B SaaS'],
    employee_count: 120,
    fit_score: 82,
    why_this_lead: 'Matches target industry and size',
    raw: {
      // DB row; the jsonb lives one level deeper at raw.raw.
      raw: {
        domain: 'acme.example',
        source_proof: [{ url: 'https://boards.example/acme/revops-1' }, { url: 'https://acme.example/about' }, 'https://news.example/acme'],
        company_enrichment: {
          company_summary: 'Acme Robotics builds warehouse automation robots for mid-market logistics teams.',
          evidence_urls: ['https://acme.example', 'https://acme.example/product'],
          confidence: 'high',
          status: 'enriched',
          category: 'Robotics',
          missing_evidence: [],
        },
        agentory_workbench: { company_research: { status: 'succeeded', succeeded_at: recent } },
        ...jsonb,
      },
    },
    ...over,
  };
  return base;
}

const savedIcp: SavedIcp = {
  industries: ['B2B SaaS'],
  company_size: ['51–200'],
  geographies: ['United States'],
  buyer_roles: ['Revenue Operations'],
  disqualifiers: ['staffing agency'],
};

describe('hydration — source counting (the false "no sources" fix)', () => {
  it('counts website + company LinkedIn + job posting + proof + enrichment as sources', () => {
    const s = hydrateAccountResearchSnapshot(sourcedRow(), { now });
    // website, linkedin, job_url, acme.example/about, news.example/acme, acme.example/product
    expect(s.source_count).toBeGreaterThanOrEqual(4);
    expect(s.evidence.some((e) => e.kind === 'website')).toBe(true);
    expect(s.evidence.some((e) => e.kind === 'company_linkedin')).toBe(true);
    expect(s.evidence.some((e) => e.kind === 'job_posting')).toBe(true);
    expect(s.status).toBe('available');
  });

  it('deduplicates evidence by normalized URL (www + trailing slash + scheme)', () => {
    const s = hydrateAccountResearchSnapshot(
      sourcedRow({ website: 'https://acme.example/' }),
      { now },
    );
    const keys = s.evidence.map((e) => e.url);
    // acme.example appears once despite website + job_url source_proof overlap.
    const acmeRoot = keys.filter((u) => /acme\.example$/.test(u.replace(/^https?:\/\//, '')));
    expect(acmeRoot.length).toBeLessThanOrEqual(1);
  });

  it('a bare sourced row with only a website + job still has sources (never "No sources yet")', () => {
    const row = sourcedRow({}, { source_proof: [], company_enrichment: { company_summary: 'Acme builds robots for logistics.', evidence_urls: [] } });
    const s = hydrateAccountResearchSnapshot(row, { now });
    expect(s.source_count).toBeGreaterThan(0);
  });
});

describe('hydration — overview + precedence + no fabrication', () => {
  it('prefers the enrichment summary and sanitizes it', () => {
    const s = hydrateAccountResearchSnapshot(sourcedRow(), { now });
    expect(s.overview.summary).toContain('Acme Robotics builds');
    expect(s.overview.industry).toBe('B2B SaaS');
    expect(s.overview.employee_range).toBe('51–200');
    expect(s.overview.category).toBe('Robotics');
  });

  it('never fabricates: no summary and no evidence ⇒ status missing', () => {
    const row = sourcedRow(
      { website: null, company_linkedin_url: null, job_url: null, job_title: null, signal_type: null, company_description: null, enrichment_summary: null, evidence_summary: null },
      { source_proof: [], company_enrichment: { company_summary: null, evidence_urls: [] }, agentory_workbench: {} },
    );
    const s = hydrateAccountResearchSnapshot(row, { now });
    expect(s.source_count).toBe(0);
    expect(s.overview.summary).toBeNull();
    expect(s.status).toBe('missing');
  });

  it('rejects markdown/newsletter furniture as a summary', () => {
    const row = sourcedRow({ enrichment_summary: '![logo](x.png) Subscribe to our newsletter' },
      { company_enrichment: { company_summary: '![logo](http://x/y.png)', evidence_urls: ['https://acme.example'] } });
    const s = hydrateAccountResearchSnapshot(row, { now });
    expect(s.overview.summary).toBeNull();
  });
});

describe('hydration — status + staleness (injected clock)', () => {
  it('available when fresh + usable', () => {
    expect(hydrateAccountResearchSnapshot(sourcedRow(), { now }).status).toBe('available');
  });
  it('stale when the posting/research date is older than the window', () => {
    const row = sourcedRow({ posted_at: old }, { agentory_workbench: { company_research: { status: 'succeeded', succeeded_at: old } }, company_enrichment: { company_summary: 'Acme builds robots for logistics teams.', evidence_urls: ['https://acme.example'] } });
    const s = hydrateAccountResearchSnapshot(row, { now, staleDays: RESEARCH_STALE_DAYS });
    expect(s.status).toBe('stale');
  });
});

describe('projection into the existing CompanyResearchView', () => {
  it('produces a usable view with the FULL source count (not just evidence_urls)', () => {
    const s = hydrateAccountResearchSnapshot(sourcedRow(), { now });
    const v = researchViewFromSnapshot(s);
    expect(v.usable).toBe(true);
    expect(v.evidence_count).toBe(s.source_count);
    expect(v.evidence_count).toBeGreaterThanOrEqual(4);
  });
});

describe('credit policy — never charge to rediscover', () => {
  it('available ⇒ View research, FREE', () => {
    const s = hydrateAccountResearchSnapshot(sourcedRow(), { now });
    const cta = researchCta(s);
    expect(cta.kind).toBe('view');
    expect(cta.paid).toBe(false);
    expect(cta.credits).toBe(0);
  });
  it('stale ⇒ Refresh research, PAID and optional', () => {
    const row = sourcedRow({ posted_at: old }, { agentory_workbench: { company_research: { status: 'succeeded', succeeded_at: old } } });
    const s = hydrateAccountResearchSnapshot(row, { now });
    const cta = researchCta(s, 4);
    expect(cta.kind).toBe('refresh');
    expect(cta.paid).toBe(true);
    expect(cta.credits).toBe(4);
  });
  it('missing ⇒ Research company, PAID', () => {
    const row = sourcedRow({ website: null, company_linkedin_url: null, job_url: null, job_title: null, signal_type: null, company_description: null, enrichment_summary: null, evidence_summary: null },
      { source_proof: [], company_enrichment: { evidence_urls: [] }, agentory_workbench: {} });
    const s = hydrateAccountResearchSnapshot(row, { now });
    expect(researchCta(s).kind).toBe('research');
    expect(hasUsableHydratedResearch(s)).toBe(false);
  });
});

describe('saved-ICP assessment (separate from sourcing fit)', () => {
  it('uses the saved ICP and matches industry/size', () => {
    const { icp_snapshot, snapshot } = hydrateAccountView(sourcedRow(), savedIcp, { now });
    expect(icp_snapshot.uses_saved_icp).toBe(true);
    expect(icp_snapshot.matched_criteria.some((m) => m.criterion === 'Industry')).toBe(true);
    // sourcing fit stays separate on the snapshot, not conflated with saved-ICP fit.
    expect(snapshot.qualification_context.sourcing_fit_score).toBe(82);
  });
  it('hard disqualifier overrides positive matches ⇒ excluded', () => {
    const { icp_snapshot } = hydrateAccountView(sourcedRow({ industries: ['staffing agency'] }), savedIcp, { now });
    expect(icp_snapshot.status).toBe('excluded');
  });
  it('no saved ICP ⇒ insufficient_evidence, never generic defaults', () => {
    const { icp_snapshot } = hydrateAccountView(sourcedRow(), null, { now });
    expect(icp_snapshot.uses_saved_icp).toBe(false);
    expect(icp_snapshot.status).toBe('insufficient_evidence');
  });
});

describe('hydration floor — preserves action results, fills sourced baseline', () => {
  it('fills company_research for a freshly loaded sourced account', () => {
    const { view } = hydrateAccountView(sourcedRow(), savedIcp, { now });
    const merged = applyHydrationFloor(view, undefined);
    expect(merged.company_research.last_success?.usable).toBe(true);
  });

  it('never overwrites a completed action stage (outreach/decision-makers survive)', () => {
    // Simulate an account that already ran Generate outreach.
    const existing = mergeWorkbenchStage(emptyAccountView('lc-1'), {
      stage: 'outreach', lead_candidate_id: 'lc-1', status: 'succeeded',
      payload: { status: 'drafted', draft_id: 'd1' }, now: new Date(FIXED_NOW).toISOString(),
    });
    const { view } = hydrateAccountView(sourcedRow(), savedIcp, { now });
    const merged = applyHydrationFloor(view, existing);
    // outreach preserved …
    expect(merged.outreach.last_success).toEqual({ status: 'drafted', draft_id: 'd1' });
    // … and research still hydrated from sourcing.
    expect(merged.company_research.last_success?.usable).toBe(true);
  });

  it('a completed research action wins over the hydrated floor', () => {
    const actionResearch = { status: 'succeeded' as const, summary: 'Deeper researched summary about Acme.', evidence_count: 9, missing_evidence: [], confidence: 'high', usable: true };
    const existing = mergeWorkbenchStage(emptyAccountView('lc-1'), {
      stage: 'company_research', lead_candidate_id: 'lc-1', status: 'succeeded',
      payload: actionResearch, now: new Date(FIXED_NOW).toISOString(),
    });
    const { view } = hydrateAccountView(sourcedRow(), savedIcp, { now });
    const merged = applyHydrationFloor(view, existing);
    expect(merged.company_research.last_success?.evidence_count).toBe(9);
  });
});

describe('outreach readiness — specific blockers only', () => {
  const s = () => hydrateAccountResearchSnapshot(sourcedRow(), { now });
  it('blocks on missing Company Brain', () => {
    const r = outreachReadiness({ snapshot: s(), hasVerifiedDecisionMaker: true, companyBrainPresent: false, icpStatus: 'moderate_fit' });
    expect(r).toEqual({ ready: false, blocker: 'missing_company_brain', message: 'Complete Company Brain first' });
  });
  it('blocks on missing decision-maker', () => {
    const r = outreachReadiness({ snapshot: s(), hasVerifiedDecisionMaker: false, companyBrainPresent: true, icpStatus: 'moderate_fit' });
    expect(r).toEqual({ ready: false, blocker: 'missing_person', message: 'Find a verified decision-maker first' });
  });
  it('blocks (skip) on excluded', () => {
    const r = outreachReadiness({ snapshot: s(), hasVerifiedDecisionMaker: true, companyBrainPresent: true, icpStatus: 'excluded' });
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.blocker).toBe('excluded');
  });
  it('ready when research + brain + verified person all present', () => {
    const r = outreachReadiness({ snapshot: s(), hasVerifiedDecisionMaker: true, companyBrainPresent: true, icpStatus: 'moderate_fit' });
    expect(r.ready).toBe(true);
  });
});

describe('savedIcpFromBrain — active saved ICP, never generic defaults', () => {
  it('reads v2 array shape', () => {
    const icp = savedIcpFromBrain({ icp: { industries: ['B2B SaaS'], company_size: ['51–200'], buyer_roles: ['RevOps'], disqualifiers: ['agency'] } });
    expect(icp?.industries).toEqual(['B2B SaaS']);
    expect(icp?.company_size).toEqual(['51–200']);
    expect(icp?.disqualifiers).toEqual(['agency']);
  });
  it('coerces legacy scalar company_size/geography to arrays', () => {
    const icp = savedIcpFromBrain({ icp: { industries: ['SaaS'], company_size: '51–200', geography: 'United States' } });
    expect(icp?.company_size).toEqual(['51–200']);
    expect(icp?.geographies).toEqual(['United States']);
  });
  it('returns null when no ICP present (⇒ insufficient_evidence, not defaults)', () => {
    expect(savedIcpFromBrain(null)).toBeNull();
    expect(savedIcpFromBrain({ profile: {} })).toBeNull();
    expect(savedIcpFromBrain({ icp: {} })).toBeNull();
  });
});

describe('readLeadJsonb — the raw.raw nesting trap', () => {
  it('reads the jsonb one level deeper', () => {
    const jb = readLeadJsonb(sourcedRow());
    expect((jb.company_enrichment as Record<string, unknown>).status).toBe('enriched');
  });
  it('is safe on a missing/degenerate raw', () => {
    expect(collectEvidence({ ...sourcedRow(), website: null, company_linkedin_url: null, job_url: null, signal_source_url: null, raw: undefined } as LeadTableRow, {})).toEqual([]);
  });
});
