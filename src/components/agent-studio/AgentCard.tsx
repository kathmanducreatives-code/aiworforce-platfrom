import { Sparkles } from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import { getDeptColors, type StudioEmployee } from '@/data/agent-studio';
import { cn } from '@/lib/utils';

interface AgentCardProps {
  employee: StudioEmployee;
  onClick: (id: string) => void;
}

const AgentCard = ({ employee, onClick }: AgentCardProps) => {
  const colors = getDeptColors(employee.department);

  return (
    <button
      onClick={() => onClick(employee.id)}
      className={cn(
        'group w-full text-left rounded-xl border border-border/40 bg-card/15 p-4 transition-all duration-300',
        'hover:bg-card/30 hover:border-border/60 hover:-translate-y-0.5',
        employee.status === 'disabled' && 'opacity-40',
      )}
    >
      {/* Top row */}
      <div className="flex items-start gap-3 mb-3">
        <AgentAvatar name={employee.name} photo={employee.avatar} status={employee.status} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-semibold text-foreground truncate">{employee.name}</h4>
            {employee.isOriginal && (
              <Sparkles className={cn('h-3 w-3 flex-shrink-0', colors.text)} />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60 truncate">{employee.role}</p>
        </div>
        <span className={cn(
          'w-2 h-2 rounded-full flex-shrink-0 mt-1.5',
          employee.status === 'active' ? colors.dot : employee.status === 'idle' ? 'bg-amber-500' : 'bg-muted-foreground/20',
        )} />
      </div>

      {/* Description */}
      <p className="text-[11px] text-muted-foreground/40 leading-relaxed line-clamp-2 mb-3">
        {employee.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/30 tabular-nums">
          {employee.enabledTools.length} tools · {employee.collaboratesWith.length} links
        </span>
        <span className="text-[10px] text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors">
          {employee.lastUpdated}
        </span>
      </div>
    </button>
  );
};

export default AgentCard;
