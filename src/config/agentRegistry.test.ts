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
  // Workforce V2 identity map (2026-11-10): four departments. Legacy backend
  // slugs alias to their department for display only.
  it.each([
    ['scout', 'Atlas'],
    ['aria', 'Atlas'],
    ['hawk', 'Atlas'],
    ['penn', 'Lyra'],
    ['scribe', 'Lyra'],
    ['pilot', 'Orion'],
  ])('legacy slug %s resolves publicly to %s', (slug, publicName) => {
    expect(lookupPublicAgent(slug)?.name).toBe(publicName);
  });

  it.each([
    ['lyra', 'Lyra'],
    ['atlas', 'Atlas'],
    ['lisa', 'Lisa'],
    ['orion', 'Orion'],
    ['mira', 'Lyra'],   // retired public id → its department
    ['pilot', 'Orion'], // retired public id → its department
  ])('canonical id %s resolves to %s', (id, publicName) => {
    expect(lookupPublicAgent(id)?.name).toBe(publicName);
  });

  it('is case-insensitive for slugs and names', () => {
    expect(lookupPublicAgent('SCOUT')?.name).toBe('Atlas');
    expect(lookupPublicAgent('Atlas')?.name).toBe('Atlas');
    expect(lookupPublicAgent('  Mira  ')?.name).toBe('Lyra');
  });
});

describe('agentRegistry — historical attribution', () => {
  it('preserves attribution for rows with legacy agent_slug values', () => {
    // Simulating an activity row: { agent_slug: 'hawk' }
    const row = { agent_slug: 'hawk' as const };
    const display = resolveAgentForDisplay(row.agent_slug);
    expect(display.name).toBe('Atlas');
    expect(display.title).toBe('Sales & Lead Intelligence');
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

  it('only falls back to the coordinator (Orion, formerly Pilot) when explicitly requested', () => {
    expect(resolveAgentForDisplay('quasar', { pilotFallback: true }).name).toBe('Orion');
    expect(resolveAgentForDisplay(null, { pilotFallback: true }).name).toBe('Orion');
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
    // Sourcing, qualification and research stay individually addressable
    expect(new Set(Object.values(atlas.internalCapabilities ?? {})).size).toBe(3);
  });
});

describe('agentRegistry — public list composition', () => {
  it('publishes exactly 4 department identities in canonical order', () => {
    expect(PUBLIC_AGENT_LIST.map((a) => a.name)).toEqual(['Orion', 'Atlas', 'Lisa', 'Lyra']);
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
