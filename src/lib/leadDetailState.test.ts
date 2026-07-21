// Lead Detail must reflect canonical workbench state, not stale flat columns.
//
// Production evidence, 2026-07-21 (Harmonic Security):
//   agentory_workbench.company_research.status = "succeeded"
//   company_enrichment.status                  = "enriched"
//   agentory_workbench.outreach.last_success   = a 210-char opener
//   selected_recipient_name                    = the CRO the opener was for
// …yet Lead Detail showed ENRICHMENT "Locked", PERSONALIZED MESSAGE "Locked",
// and a DIFFERENT person as "Recommended contact".
//
// Synthetic fixtures throughout. No network, database, provider or model.

import { describe, it, expect } from 'vitest';
import {
  deriveLeadDetailState,
  RESEARCH_STATE_COPY,
  OUTREACH_STATE_COPY,
  RECIPIENT_UNKNOWN_COPY,
} from './leadDetailState';

const OPENER = 'Sample opener text written for the selected recipient.';

/** Mirrors the production shape: workbench state present, flat columns stale. */
function productionShapedRow(over: Record<string, unknown> = {}) {
  return {
    // Flat sourcing-era columns are deliberately NOT set — exactly as in prod.
    enrichment_status: null,
    draft_status: null,
    raw: {
      raw: {
        company_enrichment: { status: 'enriched', summary: 'A synthetic summary.' },
        agentory_workbench: {
          company_research: { status: 'succeeded', last_success: { summary: 'A synthetic summary.' } },
          outreach: {
            status: 'succeeded',
            last_success: {
              status: 'succeeded',
              opener: OPENER,
              selected_recipient_name: 'Sample Person',
              selected_recipient_title: 'Chief Revenue Officer',
              personalization_depth: 'specific',
              generated_at: '2026-07-21T07:43:10.899Z',
              sent: false,
            },
          },
          ...(over.workbench ?? {}),
        },
      },
    },
  };
}

describe('the production defect', () => {
  it('9. successful research prevents the Locked state', () => {
    const s = deriveLeadDetailState(productionShapedRow());
    expect(s.researchLocked).toBe(false);
    expect(s.research).toBe('ready');
  });

  it('10. a successful opener prevents the Locked state', () => {
    const s = deriveLeadDetailState(productionShapedRow());
    expect(s.outreachLocked).toBe(false);
    expect(s.outreach).toBe('draft_ready');
    expect(s.opener?.opener).toBe(OPENER);
  });

  it('5/8. the persisted generation recipient wins', () => {
    const s = deriveLeadDetailState(productionShapedRow());
    expect(s.selectedRecipientName).toBe('Sample Person');
    expect(s.selectedRecipientTitle).toBe('Chief Revenue Officer');
    expect(s.recipientUnknownForHistoricalDraft).toBe(false);
  });

  it('a stale flat draft_status cannot lock a real opener', () => {
    // The opener path writes no draft row, so draft_status stays null forever.
    const s = deriveLeadDetailState(productionShapedRow({ draft_status: null }));
    expect(s.outreachLocked).toBe(false);
  });
});

describe('research state', () => {
  it('an enrichment blob alone is enough', () => {
    const s = deriveLeadDetailState({
      raw: { raw: { company_enrichment: { status: 'enriched' } } },
    });
    expect(s.researchLocked).toBe(false);
  });

  it('the legacy flat column still works for old rows', () => {
    const s = deriveLeadDetailState({ enrichment_status: 'enriched', raw: { raw: {} } });
    expect(s.researchLocked).toBe(false);
  });

  it('11. a failed retry preserves the previous result', () => {
    const s = deriveLeadDetailState(productionShapedRow({
      workbench: {
        company_research: { status: 'failed', last_success: { summary: 'A synthetic summary.' } },
      },
    }));
    // Still not locked — and the UI can say the refresh failed.
    expect(s.researchLocked).toBe(false);
    expect(s.research).toBe('previous_result_latest_failed');
  });

  it('nothing anywhere is genuinely Locked', () => {
    const s = deriveLeadDetailState({ raw: { raw: {} } });
    expect(s.researchLocked).toBe(true);
    expect(s.research).toBe('not_started');
  });
});

describe('outreach state', () => {
  it('12. a failed retry preserves the previous draft', () => {
    const s = deriveLeadDetailState(productionShapedRow({
      workbench: {
        outreach: {
          status: 'failed_validation',
          last_success: { status: 'succeeded', opener: OPENER, selected_recipient_name: 'Sample Person' },
        },
      },
    }));
    expect(s.outreachLocked).toBe(false);
    expect(s.outreach).toBe('previous_draft_latest_failed');
    expect(s.opener?.opener).toBe(OPENER);
  });

  it('a blocked lead with no prior draft is Not generated', () => {
    const s = deriveLeadDetailState({
      raw: { raw: { agentory_workbench: { outreach: { status: 'blocked', last_success: null } } } },
    });
    expect(s.outreachLocked).toBe(true);
    expect(s.outreach).toBe('failed_no_previous');
  });

  it('the legacy full_draft path still reports Draft ready', () => {
    const s = deriveLeadDetailState({ draft_status: 'drafted', raw: { raw: {} } });
    expect(s.outreachLocked).toBe(false);
  });
});

describe('recipient provenance', () => {
  it('6. a historical draft with no recorded recipient is marked unknown', () => {
    const s = deriveLeadDetailState({
      raw: {
        raw: {
          agentory_workbench: {
            outreach: { status: 'succeeded', last_success: { status: 'succeeded', opener: OPENER } },
          },
        },
      },
    });
    expect(s.opener?.opener).toBe(OPENER);
    expect(s.selectedRecipientName).toBeNull();
    // Never guessed from another contact.
    expect(s.recipientUnknownForHistoricalDraft).toBe(true);
    expect(RECIPIENT_UNKNOWN_COPY).toBe('Not recorded for this older draft');
  });

  it('16. one lead cannot inherit another lead state', () => {
    // Derivation is a pure function of THIS row — nothing task-wide is read.
    const a = deriveLeadDetailState(productionShapedRow());
    const b = deriveLeadDetailState({ raw: { raw: {} } });
    expect(a.selectedRecipientName).toBe('Sample Person');
    expect(b.selectedRecipientName).toBeNull();
    expect(b.outreachLocked).toBe(true);
  });

  it('no recipient is invented when there is no opener at all', () => {
    const s = deriveLeadDetailState({ raw: { raw: {} } });
    expect(s.selectedRecipientName).toBeNull();
    expect(s.recipientUnknownForHistoricalDraft).toBe(false);
  });
});

describe('copy', () => {
  it('19/20. every state has non-undefined copy', () => {
    for (const c of [...Object.values(RESEARCH_STATE_COPY), ...Object.values(OUTREACH_STATE_COPY)]) {
      expect(c).toBeTruthy();
      expect(c).not.toMatch(/undefined/i);
    }
    expect(OUTREACH_STATE_COPY.draft_ready).toBe('Draft ready');
    expect(RESEARCH_STATE_COPY.ready).toBe('Ready');
  });

  it('malformed or absent raw degrades safely', () => {
    for (const bad of [undefined, null, 'string', 42, []]) {
      const s = deriveLeadDetailState({ raw: bad });
      expect(s.researchLocked).toBe(true);
      expect(s.outreachLocked).toBe(true);
    }
  });
});
