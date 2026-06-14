import { describe, it, expect } from 'vitest';
import { computeCompleteness } from './brainCompleteness';

describe('computeCompleteness', () => {
  it('empty profile = 0%', () => {
    const r = computeCompleteness(null);
    expect(r.percent).toBe(0);
    expect(r.missing.length).toBe(r.total);
  });

  it('partial profile counts filled checks', () => {
    const r = computeCompleteness({
      company_name: 'Agentory',
      website_url: 'https://agentory.space',
      icp: { buyer_roles: ['Founder'] },
      approval_rules: { draft_only: true },
    } as any);
    expect(r.percent).toBeGreaterThan(0);
    expect(r.percent).toBeLessThan(100);
    expect(r.missing).toContain('Pain points');
  });

  it('full profile = 100%', () => {
    const r = computeCompleteness({
      company_name: 'Agentory',
      website_url: 'https://x',
      short_description: 'AI workforce',
      icp: { buyer_roles: ['Founder'], industries: ['SaaS'], pain_points: ['slow ops'], company_size: '10-50', geography: 'US' },
      goals: { gtm: 'find leads' },
      competitors: { known: ['Clay'], adjacent: [], unknown: false },
      brand_voice: { tone: 'founder-led', tags: ['direct'], avoid: [] },
      approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true },
    });
    expect(r.percent).toBe(100);
    expect(r.missing).toEqual([]);
  });

  it('competitors.unknown=true counts as filled', () => {
    const r = computeCompleteness({ competitors: { unknown: true } } as any);
    expect(r.missing).not.toContain('Competitors');
  });
});
