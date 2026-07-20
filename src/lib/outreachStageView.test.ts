// The generated personalized opener must survive reconciliation, refresh and
// export.
//
// Production evidence, 2026-07-20 08:05:56Z (Harmonic Security): the opener was
// correct in `result.per_lead[].opener` AND correctly persisted to
// `raw.agentory_workbench.outreach.last_success` (170 chars, validation_ok,
// approval_status draft, sent false). The frontend stored only `{ status }`
// during reconciliation and read a legacy full_draft field on export, so the row
// said "Draft ready for approval" with nothing to show and the CSV said
// "Not generated".
//
// Fixtures are SYNTHETIC. Pure module tests: no network, database, provider or
// model.

import { describe, it, expect } from 'vitest';
import {
  toOutreachStageView,
  hydrateOutreachStage,
  OUTREACH_DRAFT_READY_COPY,
  OUTREACH_MISSING_CONTENT_COPY,
} from './outreachStageView';

const OPENER = 'Saw the governance work and wondered how your team handles agent oversight today.';
const ALTERNATIVE = 'Curious how you are approaching agent oversight as the surface grows.';

/** A per_lead row exactly as the opener path returns it. */
function perLead(overrides: Record<string, unknown> = {}) {
  return {
    status: 'succeeded',
    reason_code: 'ready',
    opener: OPENER,
    alternative_opener: ALTERNATIVE,
    personalization_depth: 'specific',
    used_evidence_ids: ['research_1'],
    approval_required: true,
    approval_status: 'draft',
    generated_at: '2026-07-20T08:05:56.000Z',
    output_mode: 'personalized_opener',
    sent: false,
    ...overrides,
  };
}

/** The persisted lead jsonb shape. */
function rawWithOpener(overrides: Record<string, unknown> = {}) {
  return {
    agentory_workbench: {
      outreach: {
        status: 'succeeded',
        reason_code: 'ready',
        last_success: perLead(),
        ...overrides,
      },
    },
  };
}

describe('reconciliation preserves the whole result', () => {
  it('1/2. a successful opener is NOT reduced to status-only', () => {
    const v = toOutreachStageView(perLead());
    expect(v).not.toBeNull();
    expect(v!.status).toBe('succeeded');
    expect(v!.opener).toBe(OPENER);
    expect(v!.alternative_opener).toBe(ALTERNATIVE);
    expect(v!.personalization_depth).toBe('specific');
    expect(v!.used_evidence_ids).toEqual(['research_1']);
    expect(v!.approval_required).toBe(true);
    expect(v!.approval_status).toBe('draft');
    expect(v!.generated_at).toBe('2026-07-20T08:05:56.000Z');
  });

  it('sent is never inferred — absent means false', () => {
    expect(toOutreachStageView(perLead()).sent).toBe(false);
    const noSentKey = perLead();
    delete (noSentKey as Record<string, unknown>).sent;
    expect(toOutreachStageView(noSentKey)!.sent).toBe(false);
  });

  it('10. the opener does not depend on a full_draft body', () => {
    // No draft_id, no legacy body — opener mode creates neither.
    const v = toOutreachStageView(perLead())!;
    expect(v.opener).toBe(OPENER);
    expect(v.draft_id).toBeUndefined();
  });

  it('6. legacy personalized_message is fallback only', () => {
    const legacy = toOutreachStageView({ status: 'succeeded', personalized_message: 'Legacy body.' })!;
    expect(legacy.opener).toBe('Legacy body.');
    // Canonical wins when both are present.
    const both = toOutreachStageView({ ...perLead(), personalized_message: 'Legacy body.' })!;
    expect(both.opener).toBe(OPENER);
  });

  it('a payload with no status is not stored at all', () => {
    // Returning null lets the reducer keep a previous success rather than
    // overwrite it with an empty object.
    expect(toOutreachStageView({})).toBeNull();
    expect(toOutreachStageView(null)).toBeNull();
    expect(toOutreachStageView('nonsense')).toBeNull();
  });
});

describe('refresh hydration', () => {
  it('3. the persisted last_success opener hydrates', () => {
    const h = hydrateOutreachStage(rawWithOpener());
    expect(h.last_success?.opener).toBe(OPENER);
    expect(h.last_success?.approval_status).toBe('draft');
    expect(h.latest_status).toBe('succeeded');
  });

  it('4. a failed latest attempt does not erase last_success', () => {
    const h = hydrateOutreachStage(rawWithOpener({
      status: 'failed_validation',
      reason_code: 'failed_validation',
    }));
    // The retry status is reported separately; the valid opener survives.
    expect(h.latest_status).toBe('failed_validation');
    expect(h.latest_reason_code).toBe('failed_validation');
    expect(h.last_success?.opener).toBe(OPENER);
  });

  it('18. a lead with no workbench stage hydrates to nothing, not junk', () => {
    expect(hydrateOutreachStage({}).last_success).toBeNull();
    expect(hydrateOutreachStage({ agentory_workbench: {} }).last_success).toBeNull();
    expect(hydrateOutreachStage(null).last_success).toBeNull();
  });

  it('a stage whose last_success is null yields null', () => {
    const h = hydrateOutreachStage({
      agentory_workbench: { outreach: { status: 'blocked', reason_code: 'blocked_missing_verified_person', last_success: null } },
    });
    expect(h.last_success).toBeNull();
    expect(h.latest_status).toBe('blocked');
  });
});

describe('copy constants', () => {
  it('9. the missing-content state is neither "ready" nor "not generated"', () => {
    expect(OUTREACH_MISSING_CONTENT_COPY).toBe('Draft succeeded, but the message could not be loaded.');
    expect(OUTREACH_MISSING_CONTENT_COPY).not.toBe(OUTREACH_DRAFT_READY_COPY);
    expect(OUTREACH_MISSING_CONTENT_COPY).not.toMatch(/not generated/i);
  });

  it('26. no copy renders undefined', () => {
    for (const c of [OUTREACH_DRAFT_READY_COPY, OUTREACH_MISSING_CONTENT_COPY]) {
      expect(c).toBeTruthy();
      expect(c).not.toMatch(/undefined/i);
    }
  });
});

describe('safety', () => {
  it('29. no prompt, provider payload or trace is carried into the view', () => {
    const v = toOutreachStageView(perLead({
      prompt: 'SYSTEM PROMPT TEXT',
      provider_response: { raw: 'RAW PROVIDER PAYLOAD' },
      model_trace: ['step'],
    }))!;
    const serialised = JSON.stringify(v);
    expect(serialised).not.toMatch(/SYSTEM PROMPT TEXT/);
    expect(serialised).not.toMatch(/RAW PROVIDER PAYLOAD/);
    expect(serialised).not.toMatch(/model_trace/);
  });

  it('22/34-36. the view carries no send affordance and no regeneration trigger', () => {
    const v = toOutreachStageView(perLead())!;
    // Reading a persisted opener is a pure data transform — there is nothing
    // here that could call a model or send anything.
    expect(v.sent).toBe(false);
    expect(Object.keys(v)).not.toContain('send');
    expect(typeof (v as unknown as Record<string, unknown>).regenerate).toBe('undefined');
  });
});
