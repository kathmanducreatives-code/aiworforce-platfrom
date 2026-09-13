import AgentPortrait from '@/components/agents/AgentPortrait';
import { type AgentId, type AgentStatusKind, statusDot } from './agents';
import { cn } from '@/lib/utils';

interface Props {
  id: AgentId;
  size?: number;
  status?: AgentStatusKind;
  badge?: number | string | null;
  withRing?: boolean;
  active?: boolean;
  className?: string;
}

export default function AgentAvatar({ id, size = 44, status, badge, withRing = true, active, className }: Props) {
  return (
    <div className={cn('relative inline-block', className)} style={{ width: size, height: size }}>
      <AgentPortrait agentId={id} size={size} ring={withRing} active={active} />
      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-black/60',
            statusDot[status],

          )}
        />
      )}
      {badge != null && badge !== 0 && badge !== '0' && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center border border-black/60 tabular-nums">
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  );
}
