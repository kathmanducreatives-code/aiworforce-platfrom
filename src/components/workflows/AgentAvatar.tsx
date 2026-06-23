import { AGENT_BY_ID, type AgentProfile } from '@/data/agentProfiles';
import { cn } from '@/lib/utils';

interface Props {
  agentId: string;
  size?: number;
  ring?: boolean;
  className?: string;
}

export default function AgentAvatar({ agentId, size = 24, ring = false, className }: Props) {
  const agent: AgentProfile | undefined = AGENT_BY_ID[agentId];
  if (!agent) return null;
  const s = { width: size, height: size };
  return (
    <span
      title={`${agent.name} · ${agent.role}`}
      className={cn(
        'inline-flex items-center justify-center rounded-full overflow-hidden bg-white/[0.04] border border-white/10 shrink-0',
        ring && 'ring-1 ring-emerald-400/40',
        className,
      )}
      style={s}
    >
      {agent.image
        ? <img src={agent.image} alt={agent.name} className="w-full h-full object-cover" />
        : <span className="text-[10px] font-medium text-neutral-300">{agent.name[0]}</span>}
    </span>
  );
}
