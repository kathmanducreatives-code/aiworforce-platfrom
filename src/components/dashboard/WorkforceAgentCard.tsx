import { ArrowUpRight, MessageCircle } from 'lucide-react';
import { lookupPublicAgent } from '@/config/agentRegistry';
import { AGENTS } from '@/components/workforce/agents';
import type { AgentState } from '@/hooks/useWorkforceState';
import { AgentDepthCard } from '@/components/agents/AgentDepthCard';
import { AgentCardPortrait } from '@/components/agents/AgentCardPortrait';
import { statusWordOf, type AgentVisualState } from '@/lib/agent3d/visualState';

interface Props {
  agent: AgentState;
  /** Truthful live state (useAgentVisualStates) — drives the visual, never the copy. */
  visual?: AgentVisualState | null;
  loading: boolean;
  onProfile: () => void;
  onChat: () => void;
  onAction: () => void;
  /** An agent task finished while the page was open — a short, one-time acknowledgement. */
  justFinished?: boolean;
}



/** A portrait stage: input-driven depth, with no idle animation or render loop. */
export default function WorkforceAgentCard({ agent, visual, loading, onProfile, onChat, onAction, justFinished = false }: Props) {
  const meta = AGENTS[agent.id];
  const profile = lookupPublicAgent(agent.id);
  // The dot and the announced status are claims about right now, so they rest on
  // the same live truth as the visual (useAgentVisualStates) — never on the
  // count-based `agent.status`, which calls an agent busy because it has outputs.
  const base = visual?.base ?? 'idle';
  const attention = !loading && (base === 'awaiting' || base === 'blocked');
  const status = loading ? 'Loading workspace' : visual?.reason ?? 'No live work';
  const statusWord = justFinished ? 'Just finished' : statusWordOf(visual);
  const statusTone = justFinished ? 'done' : base;
  // VISUAL FIRST: at rest a card is the portrait and the name. The role and the
  // two actions are revealed on hover or keyboard focus; the profile (top right)
  // stays available on touch. Status is still announced to screen readers, and
  // a small dot marks an agent that needs you — nothing else is always on.
  return <AgentDepthCard className="team-agent team-agent--depth" accent={profile?.accentHex ?? '#10B981'} label={`${meta.name} — ${meta.role}`}>
    <div className="team-agent__surface" data-just-finished={justFinished || undefined}>
      <AgentCardPortrait stage id={profile?.id ?? agent.id} name={meta.name} role={meta.role} src={profile?.avatar} />
      <div className="team-agent__shade" />
      <div className="team-agent__reflection" />
      {!loading && <span className="team-agent__status" data-tone={statusTone} title={status} aria-hidden><i />{statusWord}</span>}
      <button className="team-agent__profile" onClick={onProfile} aria-label={`View ${meta.name}'s profile`}><span className="team-agent__profile-label" aria-hidden>View agent</span><ArrowUpRight size={16} /></button>
      <div className="team-agent__body">
        <h2>{meta.name}{attention && <span className="team-agent__attention" title={status} aria-hidden />}</h2>
        <span className="sr-only">{status}</span>
        <div className="team-agent__reveal">
          <span className="team-agent__specialty">{meta.role.replace('AI ', '')}</span>
          <div className="team-agent__actions"><button onClick={onAction} title={agent.nextAction.label}><span className="team-agent__action-label">{agent.nextAction.label}</span><ArrowUpRight size={14} className="shrink-0" /></button><button onClick={onChat} aria-label={`Chat with ${meta.name}`}><MessageCircle size={16} /></button></div>
        </div>
      </div>
    </div>
  </AgentDepthCard>;
}
