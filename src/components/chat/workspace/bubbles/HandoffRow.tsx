import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { profileById } from '@/lib/agentDeptIndex';
import { cn } from '@/lib/utils';
import { deptRing, deptText } from '@/data/agentProfiles';
import ParticleTrail from '../effects/ParticleTrail';

interface Props {
  fromAgentId: string | null;
  toAgentId: string | null;
}

export default function HandoffRow({ fromAgentId, toAgentId }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const from = profileById(agents, fromAgentId);
  const to = profileById(agents, toAgentId);

  const Avatar = ({ p }: { p: ReturnType<typeof profileById> }) => (
    <div className={cn(
      'h-7 w-7 rounded-full ring-2 overflow-hidden bg-card border border-border/60',
      p ? deptRing[p.department] : 'ring-border',
    )}>
      {p?.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : null}
    </div>
  );

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <Avatar p={from} />
      <ParticleTrail count={4} />
      <Avatar p={to} />
      <span className="ml-2 text-[11px] text-muted-foreground">
        <span className={from ? deptText[from.department] : ''}>{from?.name ?? '?'}</span>
        {' handed off to '}
        <span className={to ? deptText[to.department] : ''}>{to?.name ?? '?'}</span>
      </span>
    </div>
  );
}
