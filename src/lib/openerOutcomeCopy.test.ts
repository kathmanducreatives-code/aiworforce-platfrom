// Blocked/failed personalized-opener outcomes must reach the user as distinct,
// truthful copy.
//
// Regression cover for the 2026-07-19 batch, where four correctly-BLOCKED leads
// all displayed "Provider or persistence failed" — a provider fault that never
// happened. Pure module tests: no network, no database, no provider, no React.

import { describe, it, expect } from 'vitest';
import {
  OUTREACH_BLOCK_COPY,
  OUTREACH_FAILURE_COPY,
  outreachBlockCopy,
  outreachOutcomeCopy,
} from './companyResearchDisplay';
import { rowActionCopy, type RowAction } from './leadRowAction';
import { ROW_STATUS_COPY } from './leadActionOutcome';

const GENERIC_PROVIDER_COPY = 'Provider or persistence failed';

function outreachRow(status: RowAction['status'], reason_code?: string): RowAction {
  return { kind: 'generate_outreach', status, reason_code };
}

describe('canonical opener blocker copy', () => {
  it('18. blocked_missing_verified_person names the missing prerequisite', () => {
    // The backend emits `blocked_missing_verified_person`; only the older
    // `blocked_missing_person` used to be mapped.
    expect(outreachBlockCopy('blocked_missing_verified_person'))
      .toBe('Find a verified decision-maker first');
    expect(rowActionCopy(outreachRow('blocked', 'blocked_missing_verified_person')))
      .toBe('Find a verified decision-maker first');
  });

  it('every canonical blocker has specific copy', () => {
    const expected: Record<string, string> = {
      blocked_missing_verified_person: 'Find a verified decision-maker first',
      blocked_missing_company_brain: 'Complete Company Brain before drafting',
      blocked_missing_company_research: 'Add usable company research first',
      blocked_icp_disqualified: 'This account is excluded by your saved ICP',
      blocked_person_contract_invalid: 'Decision-maker data could not be validated',
    };
    for (const [code, copy] of Object.entries(expected)) {
      expect(OUTREACH_BLOCK_COPY[code], code).toBe(copy);
      expect(rowActionCopy(outreachRow('blocked', code)), code).toBe(copy);
    }
  });

  it('24. a blocked result is never displayed as a provider or persistence failure', () => {
    for (const code of Object.keys(OUTREACH_BLOCK_COPY)) {
      expect(rowActionCopy(outreachRow('blocked', code))).not.toBe(GENERIC_PROVIDER_COPY);
    }
  });

  it('25. a blocked result needs no opener to render copy', () => {
    // A blocked lead correctly has no opener; that absence must not itself be
    // read as a failure.
    const copy = rowActionCopy(outreachRow('blocked', 'blocked_missing_verified_person'));
    expect(copy).toBeTruthy();
    expect(copy).not.toMatch(/undefined/i);
  });
});

describe('non-blocked opener outcomes stay distinct', () => {
  it('19-22. attempted-but-unfinished outcomes each read truthfully', () => {
    const cases: Array<[string, string]> = [
      ['provider_not_configured', 'Outreach generation is unavailable'],
      ['provider_timed_out', 'Outreach generation timed out'],
      ['failed_validation', 'Generated opener did not pass evidence and safety checks'],
      ['persistence_failed', 'Opener was generated but could not be saved'],
    ];
    for (const [code, copy] of cases) {
      expect(OUTREACH_FAILURE_COPY[code], code).toBe(copy);
    }
  });

  it('a validation failure is not reported as a provider fault', () => {
    expect(rowActionCopy(outreachRow('failed', 'failed_validation')))
      .toBe('Generated opener did not pass evidence and safety checks');
  });

  it('a persistence failure says the opener was generated but not saved', () => {
    // "Generated but not saved" is a materially different instruction to the
    // user than "the provider failed".
    expect(rowActionCopy(outreachRow('failed', 'persistence_failed')))
      .toBe('Opener was generated but could not be saved');
  });

  it('23. an unclassified failure still falls back to honest generic copy', () => {
    expect(rowActionCopy(outreachRow('failed'))).toBe(GENERIC_PROVIDER_COPY);
    expect(outreachOutcomeCopy(undefined)).toBe('Could not generate the opener');
    expect(outreachOutcomeCopy('something_unmapped')).toBe('Could not generate the opener');
  });

  it('17. the blocked status vocabulary itself is preserved', () => {
    expect(ROW_STATUS_COPY.blocked).toBeTruthy();
    expect(ROW_STATUS_COPY.blocked).not.toBe(GENERIC_PROVIDER_COPY);
    expect(ROW_STATUS_COPY.unavailable).not.toBe(GENERIC_PROVIDER_COPY);
    expect(ROW_STATUS_COPY.timed_out).not.toBe(GENERIC_PROVIDER_COPY);
  });

  it('28. no outcome renders undefined text', () => {
    const codes = [...Object.keys(OUTREACH_BLOCK_COPY), ...Object.keys(OUTREACH_FAILURE_COPY)];
    for (const code of codes) {
      for (const status of ['blocked', 'failed', 'timed_out', 'unavailable'] as const) {
        const copy = rowActionCopy(outreachRow(status, code));
        expect(copy, `${status}/${code}`).toBeTruthy();
        expect(copy, `${status}/${code}`).not.toMatch(/undefined/i);
      }
    }
  });
});
