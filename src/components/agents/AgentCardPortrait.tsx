import { useState } from 'react';
import AgentPortrait from './AgentPortrait';
import { AgentWorkEffect, type AgentEffectType } from './AgentWorkEffect';
import lyra from '@/assets/agents/cutouts/lyra.png';
import atlas from '@/assets/agents/cutouts/atlas.png';
import mira from '@/assets/agents/cutouts/mira.png';
import orion from '@/assets/agents/cutouts/orion.png';

const portraits: Record<string, { image: string; effect: AgentEffectType }> = {
  lyra: { image: lyra, effect: 'research' },
  atlas: { image: atlas, effect: 'analysis' },
  mira: { image: mira, effect: 'outreach' },
  orion: { image: orion, effect: 'pipeline' },
};
export function AgentCardPortrait({ id, name, src, role, stage = false }: { id: string; name: string; src?: string; role: string; stage?: boolean }) {
  const [failed, setFailed] = useState(false);
  const config = portraits[id];
  const effect = config?.effect ?? (/content|scrib|writ/i.test(role) ? 'content' : /research|signal/i.test(role) ? 'research' : /outreach|message/i.test(role) ? 'outreach' : /analy|account/i.test(role) ? 'analysis' : 'pipeline');
  if (stage) return <div className="team-agent__portrait-stage" aria-hidden="true">
    <AgentWorkEffect type={effect} />
    <img className="team-agent__cutout" src={!failed && config ? config.image : src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
  </div>;
  return <span className="agent-card-portrait">
    <AgentWorkEffect type={effect} />
    <span className="agent-card-portrait__frame">
      {config && !failed ? <img className="agent-card-portrait__image" src={config.image} alt={name} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} /> : <AgentPortrait agentId={id} name={name} src={src} size={56} shape="squircle" interactive={false} />}
    </span>
  </span>;
}
