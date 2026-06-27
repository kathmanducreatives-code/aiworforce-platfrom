import { describe, it, expect } from 'vitest';
import { getWorkflowCost, computeActualCharge, WORKFLOW_CREDIT_COSTS } from './workflowCosts';
import { PRICING_PLANS, getPlan } from './plans';

describe('workflow credit costs', () => {
  it('returns canonical cost for known workflow', () => {
    expect(getWorkflowCost('signal_radar_scan_top_10')).toBe(
      WORKFLOW_CREDIT_COSTS.signal_radar_scan_top_10,
    );
  });

  it('scales hiring signal leads by count', () => {
    expect(getWorkflowCost('find_hiring_signal_accounts', { count: 5 })).toBe(
      WORKFLOW_CREDIT_COSTS.hiring_signal_leads_5,
    );
    expect(getWorkflowCost('find_hiring_signal_accounts', { count: 10 })).toBe(
      WORKFLOW_CREDIT_COSTS.hiring_signal_leads_10,
    );
    expect(
      getWorkflowCost('find_hiring_signal_accounts', { count: 20 }),
    ).toBeGreaterThan(WORKFLOW_CREDIT_COSTS.hiring_signal_leads_10);
  });

  it('scales enrichment by company count', () => {
    expect(getWorkflowCost('enrich_companies', { count: 5 })).toBe(
      5 * WORKFLOW_CREDIT_COSTS.enrich_company,
    );
  });

  it('falls back to safe default for unknown workflow', () => {
    expect(getWorkflowCost('mystery_workflow_xyz')).toBe(2);
  });
});

describe('computeActualCharge — fair charging policy', () => {
  it('charges 0 when provider did not run', () => {
    const r = computeActualCharge({ estimated: 15, requested: 5, accepted: 0, providerRan: false });
    expect(r.status).toBe('not_charged');
    expect(r.actual).toBe(0);
  });

  it('charges 0 when failed before provider', () => {
    const r = computeActualCharge({
      estimated: 15, requested: 5, accepted: 3, providerRan: true, failedBeforeProvider: true,
    });
    expect(r.status).toBe('not_charged');
  });

  it('charges full when all results accepted', () => {
    const r = computeActualCharge({ estimated: 15, requested: 5, accepted: 5, providerRan: true });
    expect(r.status).toBe('charged');
    expect(r.actual).toBe(15);
  });

  it('charges proportional for partial results, with min floor', () => {
    const r = computeActualCharge({ estimated: 15, requested: 5, accepted: 3, providerRan: true });
    expect(r.status).toBe('partial');
    expect(r.actual).toBeGreaterThan(0);
    expect(r.actual).toBeLessThan(15);
  });

  it('charges minimum when provider ran but produced no accepted output', () => {
    const r = computeActualCharge({ estimated: 15, requested: 5, accepted: 0, providerRan: true });
    expect(r.status).toBe('minimum_charge');
    expect(r.actual).toBeGreaterThan(0);
    expect(r.actual).toBeLessThan(15);
  });
});

describe('PRICING_PLANS', () => {
  it('exposes all 5 plans', () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual([
      'free_trial', 'starter', 'founder_pro', 'growth', 'scale',
    ]);
  });

  it('highlights Founder Pro', () => {
    expect(getPlan('founder_pro').highlighted).toBe(true);
  });

  it('falls back to free_trial for unknown plan id', () => {
    expect(getPlan('nope').id).toBe('free_trial');
  });
});
