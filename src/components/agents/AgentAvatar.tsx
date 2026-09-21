import AgentPortrait from './AgentPortrait';
import { cn } from '@/lib/utils';
import { AgentProfile, deptDot, AGENT_BY_ID, AGENT_BY_NAME } from '@/data/agentProfiles';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<Size, { box: string; text: string; dot: string }> = {
  xs: { box: 'w-7 h-7',   text: 'text-[10px]', dot: 'w-2 h-2'    },
  sm: { box: 'w-8 h-8',   text: 'text-xs',     dot: 'w-2 h-2'    },
  md: { box: 'w-12 h-12', text: 'text-sm',     dot: 'w-2.5 h-2.5'},
  lg: { box: 'w-24 h-24', text: 'text-2xl',    dot: 'w-3 h-3'    },
  xl: { box: 'w-40 h-40', text: 'text-4xl',    dot: 'w-4 h-4'    },
};

interface Props {
  agent?: AgentProfile;
  /** Resolve from registry by id or name when no agent is passed */
  agentId?: string;
  agentName?: string;
  size?: Size;
  showStatus?: boolean;
  status?: 'active' | 'idle';
  className?: string;
  ring?: boolean;
}

export default function AgentAvatar({
  agent, agentId, agentName, size = 'md',
  showStatus = false, status = 'active', className, ring = true,
}: Props) {
  const resolved =
    agent ??
    (agentId ? AGENT_BY_ID[agentId] : undefined) ??
    (agentName ? AGENT_BY_NAME[agentName.toLowerCase()] : undefined);

  const s = sizeMap[size];
  const dotClass = resolved ? deptDot[resolved.department] : 'bg-muted';

  return (
    <div className={cn('relative shrink-0', s.box, className)}>
      <AgentPortrait agentId={resolved?.id ?? agentId} name={resolved?.name ?? agentName} src={resolved?.image} ring={ring} />

      {showStatus && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-card',
            s.dot,
            status === 'active' ? `${dotClass}` : 'bg-muted',
          )}
        />
      )}
    </div>
  );
}
