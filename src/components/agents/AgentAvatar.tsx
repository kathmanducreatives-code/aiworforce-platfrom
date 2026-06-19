import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AgentProfile, deptRing, deptDot, AGENT_BY_ID, AGENT_BY_NAME } from '@/data/agentProfiles';

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

  const [failed, setFailed] = useState(false);
  const s = sizeMap[size];
  const ringClass = resolved ? deptRing[resolved.department] : 'ring-border/60';
  const dotClass = resolved ? deptDot[resolved.department] : 'bg-muted';
  const initial = (resolved?.name ?? agentName ?? '?')[0]?.toUpperCase() ?? '?';

  return (
    <div className={cn('relative shrink-0', s.box, className)}>
      <div
        className={cn(
          'w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center',
          ring && 'ring-2 ring-offset-0',
          ring && ringClass,
        )}
      >
        {resolved && resolved.image && !failed ? (
          <img
            src={resolved.image}
            alt={resolved.name}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />

        ) : (
          <span className={cn('font-bold text-foreground/80', s.text)}>{initial}</span>
        )}
      </div>

      {showStatus && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-card',
            s.dot,
            status === 'active' ? `${dotClass} animate-pulse` : 'bg-muted',
          )}
        />
      )}
    </div>
  );
}
