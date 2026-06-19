import { describe, it, expect } from 'vitest';
import { buildArtifactsFromMessages, buildArtifactFromMessage } from '../workbenchArtifacts';
import type { ChatMessageRow } from '../pilotChat';

function msg(over: Partial<ChatMessageRow>): ChatMessageRow {
  return {
    id: 'm1', conversation_id: 'c1', role: 'assistant', content: '', agent_slug: 'scout',
    model_used: null, tokens_used: null, is_error: false, created_at: new Date().toISOString(),
    metadata: null, ...over,
  };
}

describe('workbenchArtifacts', () => {
  it('returns null when no ui_panel', () => {
    expect(buildArtifactFromMessage(msg({}))).toBeNull();
  });

  it('builds a lead_results artifact and derives subtitle from prior user msg', () => {
    const user = msg({ id: 'u1', role: 'user', content: 'Find 5 SaaS companies hiring GTM in US' });
    const assistant = msg({
      id: 'a1',
      metadata: { ui_panel: { kind: 'lead_results', plan_id: 'p1', lead_count: 5 } },
    });
    const a = buildArtifactFromMessage(assistant, user);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe('lead_results');
    expect(a!.id).toBe('plan:p1');
    expect(a!.title).toMatch(/5 opportunities/);
    expect(a!.subtitle).toContain('Find 5 SaaS');
    expect(a!.status).toBe('complete');
  });

  it('prefers explicit artifact_id', () => {
    const a = buildArtifactFromMessage(msg({
      metadata: { ui_panel: { kind: 'lead_results', artifact_id: 'art-xyz', plan_id: 'p1', lead_count: 0 } },
    }));
    expect(a!.id).toBe('art-xyz');
    expect(a!.status).toBe('partial');
  });

  it('builds one artifact per assistant message with a panel', () => {
    const list: ChatMessageRow[] = [
      msg({ id: 'u1', role: 'user', content: 'q1' }),
      msg({ id: 'a1', metadata: { ui_panel: { kind: 'lead_results', plan_id: 'p1', lead_count: 3 } } }),
      msg({ id: 'u2', role: 'user', content: 'q2' }),
      msg({ id: 'a2', metadata: { ui_panel: { kind: 'lead_results', plan_id: 'p2', lead_count: 7 } } }),
      msg({ id: 'a3', content: 'just text' }),
    ];
    const arts = buildArtifactsFromMessages(list);
    expect(arts).toHaveLength(2);
    expect(arts[0].id).toBe('plan:p1');
    expect(arts[1].id).toBe('plan:p2');
    expect(arts[1].subtitle).toBe('q2');
  });
});
