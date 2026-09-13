import { useEffect, useRef, type PointerEvent } from 'react';
import { ArrowUpRight, MessageCircle } from 'lucide-react';
import { lookupPublicAgent } from '@/config/agentRegistry';
import { AGENTS } from '@/components/workforce/agents';
import type { AgentState } from '@/hooks/useWorkforceState';

interface Props {
  agent: AgentState;
  loading: boolean;
  onProfile: () => void;
  onChat: () => void;
  onAction: () => void;
}

/** A portrait stage: input-driven depth, with no idle animation or render loop. */
export default function WorkforceAgentCard({ agent, loading, onProfile, onChat, onAction }: Props) {
  const meta = AGENTS[agent.id];
  const profile = lookupPublicAgent(agent.id);
  const host = useRef<HTMLElement>(null);
  const frame = useRef<number>();
  const bounds = useRef<DOMRect>();
  useEffect(() => () => cancelAnimationFrame(frame.current ?? 0), []);
  function reset() {
    cancelAnimationFrame(frame.current ?? 0);
    bounds.current = undefined;
    ['--team-rx', '--team-ry', '--team-x', '--team-y', '--team-px', '--team-py'].forEach(key => host.current?.style.removeProperty(key));
  }
  function move(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return;
    const el = host.current;
    if (!el) return;
    const box = bounds.current ?? (bounds.current = el.getBoundingClientRect());
    const x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
    cancelAnimationFrame(frame.current ?? 0);
    frame.current = requestAnimationFrame(() => {
      // Restrained depth: ≤3° of tilt, light that follows the pointer, and the
      // portrait drifting a few pixels against it (parallax), all released on
      // leave so the CSS transition eases the card back to rest.
      el.style.setProperty('--team-rx', `${-y * 3}deg`);
      el.style.setProperty('--team-ry', `${x * 3}deg`);
      el.style.setProperty('--team-x', `${50 + x * 40}%`);
      el.style.setProperty('--team-y', `${50 + y * 40}%`);
      el.style.setProperty('--team-px', `${-x * 6}px`);
      el.style.setProperty('--team-py', `${-y * 4}px`);
    });
  }
  const status = loading ? 'Loading workspace' : agent.status === 'blocked' ? 'Setup needed' : agent.status === 'awaiting' ? 'Needs review' : agent.todayOutput;
  return <article ref={host} className="team-agent" onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset} aria-label={`${meta.name} — ${meta.role}`}>
    <div className="team-agent__surface">
      <img className="team-agent__portrait" src={profile?.avatar} alt="" decoding="async" draggable={false} />
      <div className="team-agent__shade" />
      <div className="team-agent__reflection" />
      <button className="team-agent__profile" onClick={onProfile} aria-label={`View ${meta.name}'s profile`}><ArrowUpRight size={16} /></button>
      <div className="team-agent__body">
        <span className="team-agent__specialty">{meta.role.replace('AI ', '')}</span>
        <h2>{meta.name}</h2>
        <p>{meta.blurb}</p>
        <div className="team-agent__status" data-attention={agent.status === 'blocked' || agent.status === 'awaiting'}><span />{status}</div>
        <div className="team-agent__actions"><button onClick={onAction} title={agent.nextAction.label}><span className="team-agent__action-label">{agent.nextAction.label}</span><ArrowUpRight size={14} className="shrink-0" /></button><button onClick={onChat} aria-label={`Chat with ${meta.name}`}><MessageCircle size={16} /></button></div>
      </div>
    </div>
  </article>;
}
