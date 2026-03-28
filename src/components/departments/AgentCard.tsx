import AgentAvatar from './AgentAvatar';
import type { AgentDef } from '@/data/agents';
import { cn } from '@/lib/utils';

interface AgentCardProps {
  agent: AgentDef;
  className?: string;
}

const AgentCard = ({ agent, className }: AgentCardProps) => {
  const isDisabled = agent.status === 'disabled';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3 transition-all duration-200',
        !isDisabled && 'hover:bg-card/80 hover:border-primary/20',
        isDisabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <AgentAvatar name={agent.name} photo={agent.photo} status={agent.status} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
        <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
      </div>
      {agent.status === 'active' && agent.lastActive && (
        <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">{agent.lastActive}</span>
      )}
      {isDisabled && (
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap">Soon</span>
      )}
    </div>
  );
};

export default AgentCard;
