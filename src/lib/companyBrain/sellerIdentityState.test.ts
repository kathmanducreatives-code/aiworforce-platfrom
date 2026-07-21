// The Company Brain page must WARN when the nested identity generation uses
// disagrees with a hidden legacy flat field — the production goji/Agentory case.

import { describe, it, expect } from 'vitest';
import { deriveSellerIdentityState, sellerIdentityBanner } from './sellerIdentityState';

describe('deriveSellerIdentityState', () => {
  it('20. UI-read identity equals the generator identity (nested wins)', () => {
    const s = deriveSellerIdentityState({ company_name: 'goji', company: { name: 'Agentory' } });
    expect(s.companyName).toBe('Agentory');
    expect(s.status).toBe('conflict');
  });

  it('flags a nested/flat name conflict', () => {
    const s = deriveSellerIdentityState({ company_name: 'goji', company: { name: 'Agentory' } });
    expect(s.conflicts.map((c) => c.field)).toContain('company_name');
    const banner = sellerIdentityBanner(s);
    expect(banner?.tone).toBe('error');
    expect(banner?.message.toLowerCase()).toContain('conflicting seller identity');
  });

  it('flags a domain conflict (gojiberry vs agentory)', () => {
    const s = deriveSellerIdentityState({
      website_url: 'https://gojiberry.ai',
      company: { name: 'Agentory', website_url: 'https://agentory.space' },
    });
    expect(s.status).toBe('conflict');
    expect(s.websiteDomain).toBe('agentory.space');
    expect(s.conflicts.some((c) => c.field === 'website_domain')).toBe(true);
  });

  it('legacy_detected when a flat field exists but does not conflict', () => {
    const s = deriveSellerIdentityState({ company_name: 'Agentory' });
    expect(s.status).toBe('legacy_detected');
    expect(sellerIdentityBanner(s)?.tone).toBe('warning');
  });

  it('resolved when only nested identity is present', () => {
    const s = deriveSellerIdentityState({ company: { name: 'Agentory' } });
    expect(s.status).toBe('resolved');
    expect(sellerIdentityBanner(s)).toBeNull();
  });

  it('confirmed when nested identity is explicitly confirmed', () => {
    const s = deriveSellerIdentityState({ company: { name: 'Agentory', name_confirmed: true } });
    expect(s.status).toBe('confirmed');
  });

  it('unavailable when nothing is set', () => {
    const s = deriveSellerIdentityState({});
    expect(s.status).toBe('unavailable');
    expect(s.companyName).toBeNull();
  });

  it('case/punctuation-only difference is not a conflict', () => {
    const s = deriveSellerIdentityState({ company_name: 'agentory.', company: { name: 'Agentory' } });
    expect(s.conflicts.length).toBe(0);
  });
});
