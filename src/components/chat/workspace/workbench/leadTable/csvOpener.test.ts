// CSV export must carry the canonical persisted personalized opener.
//
// The production export reported `personalized_message = "Not generated"` and
// `outreach_status = "Not generated"` for a lead whose opener had been
// generated, validated and persisted — because the export read the legacy
// full_draft field, which the personalized-opener path never writes.
//
// Fixtures are SYNTHETIC.

import { describe, it, expect } from 'vitest';
import { rowsToCsv } from './csv';
import type { LeadTableRow } from '@/hooks/useLeadResults';

const OPENER = 'Saw the governance work and wondered how your team handles agent oversight today.';
const GENERATED_AT = '2026-07-20T08:05:56.000Z';

/** Parse the CSV into header→value for the single data row. */
function parseSingleRow(csv: string): Record<string, string> {
  const [headerLine, ...rest] = csv.split('\n');
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(headerLine);
  const values = split(rest.join('\n'));
  const rec: Record<string, string> = {};
  headers.forEach((h, i) => { rec[h] = values[i] ?? ''; });
  return rec;
}

function row(rawJsonb: Record<string, unknown>, overrides: Partial<LeadTableRow> = {}): LeadTableRow {
  return {
    id: 'lead-1',
    company_name: 'Example Corp',
    contact_status: 'ready',
    // useLeadResults sets row.raw to the DB row; the jsonb sits one level deeper.
    raw: { raw: rawJsonb },
    ...overrides,
  } as unknown as LeadTableRow;
}

const PERSISTED_OPENER = {
  agentory_workbench: {
    outreach: {
      status: 'succeeded',
      reason_code: 'ready',
      last_success: {
        status: 'succeeded',
        opener: OPENER,
        alternative_opener: 'An alternative line.',
        personalization_depth: 'specific',
        used_evidence_ids: ['research_1'],
        approval_required: true,
        approval_status: 'draft',
        generated_at: GENERATED_AT,
        output_mode: 'personalized_opener',
        sent: false,
      },
    },
  },
  decision_makers: [{
    full_name: 'Sample Person',
    current_title: 'VP Revenue',
    verification_status: 'verified',
    rank: 1,
  }],
};

describe('CSV exports the canonical persisted opener', () => {
  it('11/12. the full opener and a truthful status export', () => {
    const rec = parseSingleRow(rowsToCsv([row(PERSISTED_OPENER)]));
    expect(rec.personalized_message).toBe(OPENER);
    expect(rec.outreach_status).toBe('Draft ready for approval');
    expect(rec.personalized_message).not.toMatch(/not generated/i);
  });

  it('13/14. approval status and personalization depth export', () => {
    const rec = parseSingleRow(rowsToCsv([row(PERSISTED_OPENER)]));
    expect(rec.approval_status).toBe('draft');
    expect(rec.personalization_depth).toBe('specific');
  });

  it('15. recipient metadata exports', () => {
    const rec = parseSingleRow(rowsToCsv([row(PERSISTED_OPENER)]));
    expect(rec.selected_recipient_name).toBe('Sample Person');
    expect(rec.selected_recipient_title).toBe('VP Revenue');
  });

  it('16/17. generated timestamp and evidence count export', () => {
    const rec = parseSingleRow(rowsToCsv([row(PERSISTED_OPENER)]));
    expect(rec.generated_at).toBe(GENERATED_AT);
    expect(rec.evidence_count).toBe('1');
  });

  it('18. a stale legacy "Not generated" does not override last_success', () => {
    // Exactly the production shape: legacy field absent/empty, canonical present.
    const rec = parseSingleRow(rowsToCsv([
      row(PERSISTED_OPENER, { personalized_message: null } as Partial<LeadTableRow>),
    ]));
    expect(rec.personalized_message).toBe(OPENER);
    expect(rec.outreach_status).toBe('Draft ready for approval');
  });

  it('a lead with no persisted opener still exports an honest status', () => {
    const rec = parseSingleRow(rowsToCsv([row({})]));
    expect(rec.personalized_message).not.toBe(OPENER);
    expect(rec.approval_status).toBe('');
    expect(rec.evidence_count).toBe('');
    expect(rec.personalized_message).not.toMatch(/undefined/i);
  });

  it('29. no prompt or provider payload is exported', () => {
    const csv = rowsToCsv([row({
      ...PERSISTED_OPENER,
      agentory_workbench: {
        outreach: {
          ...PERSISTED_OPENER.agentory_workbench.outreach,
          last_success: {
            ...PERSISTED_OPENER.agentory_workbench.outreach.last_success,
            prompt: 'SYSTEM PROMPT TEXT',
            provider_response: 'RAW PROVIDER PAYLOAD',
          },
        },
      },
    })]);
    expect(csv).not.toMatch(/SYSTEM PROMPT TEXT/);
    expect(csv).not.toMatch(/RAW PROVIDER PAYLOAD/);
  });

  it('header and row widths stay aligned after the new columns', () => {
    const csv = rowsToCsv([row(PERSISTED_OPENER)]);
    const rec = parseSingleRow(csv);
    // A misaligned row is how a value silently lands under the wrong header.
    expect(rec.outreach_status).toBe('Draft ready for approval');
    expect(rec.company).toBeDefined();
  });
});
