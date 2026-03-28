import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import { AGENTS } from '@/data/agents';
import { MOCK_ACTIVITY } from '@/data/departments';
import { cn } from '@/lib/utils';

const ActivityFeed = () => {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Today's Activity</h3>
      <div className="space-y-1">
        {MOCK_ACTIVITY.map((item, i) => {
          const agent = AGENTS.find(a => a.id === item.agentId);
          if (!agent) return null;
          const isClickable = !!item.href && !item.badge;

          return (
            <button
              key={i}
              disabled={!isClickable}
              onClick={() => isClickable && item.href && navigate(item.href)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all',
                isClickable && 'hover:bg-muted/50 group',
                !isClickable && 'opacity-60 cursor-default'
              )}
            >
              <AgentAvatar name={agent.name} photo={agent.photo} status={agent.status} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">
                  <span className="font-semibold">{agent.name}</span>{' '}
                  <span className="text-muted-foreground">{item.action}</span>
                </p>
                <p className="text-[10px] text-muted-foreground/60">{item.time}</p>
              </div>
              {item.badge && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap">{item.badge}</span>
              )}
              {isClickable && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityFeed;
