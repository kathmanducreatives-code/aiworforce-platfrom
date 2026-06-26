import { describe, it, expect } from 'vitest';
import { inferStage, pickProgressLine, PROGRESS_COPY } from './progressCopy';

describe('inferStage', () => {
  it('maps Penn → outreach', () => {
    expect(inferStage({ agentSlug: 'penn' })).toBe('outreach');
  });
  it('maps Scribe → content', () => {
    expect(inferStage({ agentSlug: 'scribe' })).toBe('content');
  });
  it('maps Hawk / firecrawl → enrichment', () => {
    expect(inferStage({ agentSlug: 'hawk' })).toBe('enrichment');
    expect(inferStage({ toolName: 'firecrawl_extract' })).toBe('enrichment');
  });
  it('maps decision-maker description → decision_makers', () => {
    expect(inferStage({ description: 'Find decision-makers at accepted accounts' })).toBe('decision_makers');
  });
  it('maps Scout / apify → lead_sourcing', () => {
    expect(inferStage({ agentSlug: 'scout' })).toBe('lead_sourcing');
    expect(inferStage({ toolName: 'source_with_apify' })).toBe('lead_sourcing');
  });
  it('defaults to general', () => {
    expect(inferStage({})).toBe('general');
  });
});

describe('pickProgressLine', () => {
  it('rotates through the stage lines deterministically', () => {
    const lines = PROGRESS_COPY.lead_sourcing;
    for (let i = 0; i < lines.length * 2; i++) {
      expect(pickProgressLine('lead_sourcing', i)).toBe(lines[i % lines.length]);
    }
  });
  it('falls back gracefully on unknown ticks', () => {
    expect(pickProgressLine('long_running', 999)).toBe(PROGRESS_COPY.long_running[0]);
  });
});
