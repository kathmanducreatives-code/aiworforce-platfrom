import { describe, it, expect } from 'vitest';
import {
  PUBLIC_AGENTS,
  PUBLIC_AGENT_LIST,
  LEGACY_TO_PUBLIC,
  LEGACY_AGENTS,
  lookupPublicAgent,
  resolveAgentForDisplay,
  UNKNOWN_AGENT_DISPLAY,
} from './agentRegistry';

describe('agentRegistry — legacy alias resolution', () => {
  it.each([
    ['scout', 'Lyra'],
    ['aria', 'Atlas'],
    ['hawk', 'Atlas'],
    ['penn', 'Mira'],
    ['scribe', 'Orion'],
    ['pilot', 'Pilot'],
  ])('legacy slug %s resolves publicly to %s', (slug, publicName) => {
    expect(lookupPublicAgent(slug)?.name).toBe(publicName);
  });

  it.each([
    ['lyra', 'Lyra'],
    ['atlas', 'Atlas'],
    ['mira', 'Mira'],
    ['orion', 'Orion'],
    ['pilot', 'Pilot'],
  ])('canonical id %s resolves to %s', (id, publicName) => {
    expect(lookupPublicAgent(id)?.name).toBe(publicName);
  });

  it('is case-insensitive for slugs and names', () => {
    expect(lookupPublicAgent('SCOUT')?.name).toBe('Lyra');
    expect(lookupPublicAgent('Atlas')?.name).toBe('Atlas');
    expect(lookupPublicAgent('  Mira  ')?.name).toBe('Mira');
  });
});

describe('agentRegistry — historical attribution', () => {
  it('preserves attribution for rows with legacy agent_slug values', () => {
    // Simulating an activity row: { agent_slug: 'hawk' }
    const row = { agent_slug: 'hawk' as const };
    const display = resolveAgentForDisplay(row.agent_slug);
    expect(display.name).toBe('Atlas');
    expect(display.title).toBe('AI Account Analyst');
  });
});

describe('agentRegistry — unknown identity behavior', () => {
  it('returns neutral Unknown display for unknown slugs by default', () => {
    const d = resolveAgentForDisplay('quasar');
    expect(d.name).toBe(UNKNOWN_AGENT_DISPLAY.name);
    expect(d.name).not.toBe('Pilot');
  });

  it('returns null from bare lookup for unknown / missing input', () => {
    expect(lookupPublicAgent(null)).toBeNull();
    expect(lookupPublicAgent(undefined)).toBeNull();
    expect(lookupPublicAgent('')).toBeNull();
    expect(lookupPublicAgent('quasar')).toBeNull();
  });

  it('only falls back to Pilot when explicitly requested', () => {
    expect(resolveAgentForDisplay('quasar', { pilotFallback: true }).name).toBe('Pilot');
    expect(resolveAgentForDisplay(null, { pilotFallback: true }).name).toBe('Pilot');
  });
});

describe('agentRegistry — Atlas capability metadata', () => {
  it('exposes Aria + Hawk as separate internal capabilities', () => {
    const atlas = PUBLIC_AGENTS.atlas;
    expect(atlas.internalCapabilities?.qualification_engine).toBe('aria');
    expect(atlas.internalCapabilities?.research_engine).toBe('hawk');
    expect(atlas.legacySlugs).toEqual(expect.arrayContaining(['aria', 'hawk']));
  });

  it('does not expose a single merged engine for Atlas', () => {
    const atlas = PUBLIC_AGENTS.atlas;
    // Ensure both engines are still individually addressable
    expect(new Set(Object.values(atlas.internalCapabilities ?? {})).size).toBe(2);
  });
});

describe('agentRegistry — public list composition', () => {
  it('publishes exactly 5 unique public identities in canonical order', () => {
    expect(PUBLIC_AGENT_LIST.map((a) => a.name)).toEqual([
      'Pilot',
      'Lyra',
      'Atlas',
      'Mira',
      'Orion',
    ]);
  });

  it('marks all 6 legacy slugs as internal / hidden', () => {
    expect(Object.keys(LEGACY_AGENTS).sort()).toEqual(
      ['aria', 'hawk', 'penn', 'pilot', 'scout', 'scribe'],
    );
    for (const entry of Object.values(LEGACY_AGENTS)) {
      expect(entry.internal).toBe(true);
      expect(entry.hiddenFromPublicSelectors).toBe(true);
    }
  });

  it('every legacy slug maps to a valid public identity', () => {
    for (const [legacy, publicId] of Object.entries(LEGACY_TO_PUBLIC)) {
      expect(PUBLIC_AGENTS[publicId as keyof typeof PUBLIC_AGENTS]).toBeDefined();
      expect(PUBLIC_AGENTS[publicId as keyof typeof PUBLIC_AGENTS].legacySlugs).toContain(legacy as any);
    }
  });
});

describe('agentRegistry — image fallback safety', () => {
  it('every public profile has a fallback initial for missing image assets', () => {
    for (const a of PUBLIC_AGENT_LIST) {
      expect(a.fallbackInitial).toMatch(/^[A-Z?]$/);
    }
  });
});
