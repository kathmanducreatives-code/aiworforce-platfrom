import { describe, it, expect } from 'vitest';
import { getBrainDefaults, mergeProfile, isOnboardingComplete } from './companyBrainSchema';

describe('companyBrainSchema', () => {
  it('returns safe defaults with approval_rules ON', () => {
    const d = getBrainDefaults();
    expect(d.approval_rules.draft_only).toBe(true);
    expect(d.approval_rules.email_requires_approval).toBe(true);
    expect(d.approval_rules.linkedin_manual_only).toBe(true);
    expect(d.icp.buyer_roles).toEqual([]);
    expect(d.competitors.unknown).toBe(false);
  });

  it('mergeProfile keeps existing flat fields and fills missing groups', () => {
    const existing = { company_name: 'Acme', short_description: 'desc' };
    const merged = mergeProfile(existing, {});
    expect(merged.company_name).toBe('Acme');
    expect(merged.short_description).toBe('desc');
    expect(merged.icp).toBeDefined();
    expect(merged.approval_rules.draft_only).toBe(true);
  });

  it('mergeProfile applies patch values without inventing data', () => {
    const merged = mergeProfile({}, {
      icp: { buyer_roles: ['CTO'], company_size: '', industries: [], geography: '', pain_points: [] },
    });
    expect(merged.icp.buyer_roles).toEqual(['CTO']);
    expect(merged.icp.industries).toEqual([]);
    expect(merged.goals.gtm).toBe('');
  });

  it('isOnboardingComplete reflects flag only', () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete({})).toBe(false);
    expect(isOnboardingComplete({ onboarding_completed: true })).toBe(true);
  });
});
