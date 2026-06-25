import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tourSteps';

describe('TOUR_STEPS', () => {
  it('has the six required sections in order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'dashboard', 'workflows', 'conversations', 'workbench', 'awaiting', 'company_brain',
    ]);
  });
  it('uses unique ids and non-empty copy', () => {
    const ids = new Set(TOUR_STEPS.map((s) => s.id));
    expect(ids.size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.where.length).toBeGreaterThan(0);
      expect(s.useItFor.length).toBeGreaterThan(0);
      expect(s.tryFirst.length).toBeGreaterThan(0);
      expect(s.ctaRoute.startsWith('/')).toBe(true);
      expect(s.anchorSelector.startsWith('[data-tour=')).toBe(true);
    }
  });
});
