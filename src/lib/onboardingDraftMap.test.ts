import { describe, it, expect } from 'vitest';
import { mapDraftToStructured, mapDraftToBasics } from './onboardingDraftMap';

describe('mapDraftToStructured', () => {
  it('returns defaults on empty/null draft', () => {
    const a = mapDraftToStructured(null);
    expect(a.competitors.known).toEqual([]);
    expect(a.competitors.unknown).toBe(true);
    expect(a.brand_voice.tone).toBe('');
  });

  it('parses competitors as string', () => {
    const a = mapDraftToStructured({ competitors: 'Notion, Linear; ClickUp' });
    expect(a.competitors.known).toEqual(['Notion', 'Linear', 'ClickUp']);
    expect(a.competitors.unknown).toBe(false);
  });

  it('parses competitors as array', () => {
    const a = mapDraftToStructured({ competitors: ['Foo', ' Bar '] });
    expect(a.competitors.known).toEqual(['Foo', 'Bar']);
  });

  it('parses brand_voice as plain string into tone', () => {
    const a = mapDraftToStructured({ brand_voice: 'direct, no hype' });
    expect(a.brand_voice.tone).toBe('direct, no hype');
  });

  it('parses brand_voice as object', () => {
    const a = mapDraftToStructured({ brand_voice: { tone: 'founder-led', tags: ['casual', 'direct'] } });
    expect(a.brand_voice.tone).toBe('founder-led');
    expect(a.brand_voice.tags).toEqual(['casual', 'direct']);
  });

  it('falls back to target_customer_profile when icp missing', () => {
    const a = mapDraftToStructured({ target_customer_profile: 'Series A SaaS founders' });
    expect(a.icp.pain_points).toEqual(['Series A SaaS founders']);
  });

  it('maps offer_summary to positioning.promise', () => {
    const a = mapDraftToStructured({ offer_summary: 'AI workforce for growth teams' });
    expect(a.positioning.promise).toBe('AI workforce for growth teams');
  });
});

describe('mapDraftToBasics', () => {
  it('handles null', () => {
    expect(mapDraftToBasics(null)).toEqual({ short_description: '', category: '' });
  });
  it('extracts company_summary', () => {
    expect(mapDraftToBasics({ company_summary: 'We help X do Y' })).toEqual({
      short_description: 'We help X do Y',
      category: '',
    });
  });
});
