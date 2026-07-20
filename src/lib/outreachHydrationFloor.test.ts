// A persisted opener must survive a page refresh, and hydrating it must not
// disturb research, decision-maker or ICP state.
//
// Fixtures are SYNTHETIC.

import { describe, it, expect } from 'vitest';
import { hydrateAccountView, applyHydrationFloor } from './accountResearchHydration';
import { emptyAccountView, type WorkbenchAccountView } from './workbenchAccountView';
import type { LeadTableRow } from '@/hooks/useLeadResults';

const OPENER = 'Saw the governance work and wondered how your team handles agent oversight today.';
const LATER_OPENER = 'A newer opener produced by an action in this session.';

function leadRow(outreachStage: Record<string, unknown> | null): LeadTableRow {
  return {
    id: 'lead-1',
    company_name: 'Example Corp',
    website: 'https://example.test',
    contact_status: 'ready',
    raw: {
      raw: {
        company_enrichment: {
          summary: 'A synthetic company summary for tests.',
          status: 'enriched',
        },
        source_proof: [{ url: 'https://example.test/about' }],
        ...(outreachStage ? { agentory_workbench: { outreach: outreachStage } } : {}),
      },
    },
  } as unknown as LeadTableRow;
}

const SUCCESSFUL_STAGE = {
  status: 'succeeded',
  reason_code: 'ready',
  last_success: {
    status: 'succeeded',
    opener: OPENER,
    personalization_depth: 'specific',
    used_evidence_ids: ['research_1'],
    approval_required: true,
    approval_status: 'draft',
    generated_at: '2026-07-20T08:05:56.000Z',
    sent: false,
  },
};

describe('refresh hydration of the outreach stage', () => {
  it('3. a persisted opener is present after hydration', () => {
    const { view } = hydrateAccountView(leadRow(SUCCESSFUL_STAGE), null);
    expect(view.outreach.last_success?.opener).toBe(OPENER);
    expect(view.outreach.last_success?.approval_status).toBe('draft');
    expect(view.outreach.attempt?.status).toBe('succeeded');
  });

  it('4. a failed latest attempt hydrates its status without erasing the opener', () => {
    const { view } = hydrateAccountView(
      leadRow({ ...SUCCESSFUL_STAGE, status: 'failed_validation', reason_code: 'failed_validation' }),
      null,
    );
    expect(view.outreach.attempt?.status).toBe('failed_validation');
    expect(view.outreach.last_success?.opener).toBe(OPENER);
  });

  it('a lead that never generated an opener hydrates to an empty stage', () => {
    const { view } = hydrateAccountView(leadRow(null), null);
    expect(view.outreach.last_success).toBeNull();
  });
});

describe('hydration is a floor, never an override', () => {
  it('an opener produced in THIS session wins over the persisted one', () => {
    const hydrated = hydrateAccountView(leadRow(SUCCESSFUL_STAGE), null).view;
    const existing: WorkbenchAccountView = {
      ...emptyAccountView('lead-1'),
      outreach: {
        attempt: { status: 'succeeded', attempted_at: '2026-07-20T09:00:00.000Z' },
        last_success: { status: 'succeeded', opener: LATER_OPENER },
      },
    };
    const merged = applyHydrationFloor(hydrated, existing);
    expect(merged.outreach.last_success?.opener).toBe(LATER_OPENER);
  });

  it('the persisted opener fills a stage the session has not advanced', () => {
    const hydrated = hydrateAccountView(leadRow(SUCCESSFUL_STAGE), null).view;
    const existing = emptyAccountView('lead-1');
    const merged = applyHydrationFloor(hydrated, existing);
    expect(merged.outreach.last_success?.opener).toBe(OPENER);
  });

  it('23/24/25. research, decision-maker and ICP state are undisturbed', () => {
    const hydrated = hydrateAccountView(leadRow(SUCCESSFUL_STAGE), null).view;
    const dmPayload = { status: 'succeeded', primary_decision_maker: { full_name: 'Sample Person' } };
    const existing: WorkbenchAccountView = {
      ...emptyAccountView('lead-1'),
      company_research: { attempt: null, last_success: { summary: 'Session research.' } as never },
      decision_makers: { attempt: null, last_success: dmPayload as never },
      icp_snapshot: { fit: 'strong' } as never,
    };
    const merged = applyHydrationFloor(hydrated, existing);

    // Hydrating the opener must not touch any neighbouring stage.
    expect((merged.company_research.last_success as { summary?: string } | null)?.summary).toBe('Session research.');
    expect(merged.decision_makers.last_success).toEqual(dmPayload);
    expect(merged.icp_snapshot).toEqual({ fit: 'strong' });
    expect(merged.outreach.last_success?.opener).toBe(OPENER);
  });
});
