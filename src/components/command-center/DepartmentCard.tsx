import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import { getAgentsByDepartment, getActiveAgentCount } from '@/data/agents';
import type { DepartmentDef } from '@/data/departments';
import { cn } from '@/lib/utils';

interface DepartmentCardProps {
  department: DepartmentDef;
  stats?: { today?: string };
  className?: string;
  style?: React.CSSProperties;
}

const COLOR_CLASSES: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  emerald: { text: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
  blue:    { text: 'text-blue-500',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    dot: 'bg-blue-500' },
  purple:  { text: 'text-purple-500',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  dot: 'bg-purple-500' },
  amber:   { text: 'text-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   dot: 'bg-amber-500' },
  pink:    { text: 'text-pink-500',    bg: 'bg-pink-500/10',    border: 'border-pink-500/20',    dot: 'bg-pink-500' },
};

const DepartmentCard = ({ department, stats, className, style }: DepartmentCardProps) => {
  const navigate = useNavigate();
  const agents = getAgentsByDepartment(department.id);
  const activeCount = getActiveAgentCount(department.id);
  const colors = COLOR_CLASSES[department.color] || COLOR_CLASSES.emerald;
  const isClickable = department.href !== null;
  const isComingSoon = department.status === 'coming-soon';

  return (
    <div
      onClick={() => isClickable && department.href && navigate(department.href)}
      className={cn(
        'relative rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 transition-all duration-300 group overflow-hidden',
        isClickable && 'cursor-pointer hover:-translate-y-1',
        !isClickable && 'cursor-default',
        className
      )}
      style={style}
      onMouseEnter={(e) => {
        if (isClickable) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 32px ${department.glowColor}`;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '';
      }}
    >
      {/* Coming Soon overlay */}
      {isComingSoon && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Coming Soon</span>
          </div>
        </div>
      )}

      {/* Header: icon + name + status */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn('p-2.5 rounded-xl', colors.bg, colors.border, 'border')}>
            <department.icon className={cn('h-5 w-5', colors.text)} />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">{department.name}</h3>
            <p className="text-xs text-muted-foreground">{department.description}</p>
          </div>
        </div>

        {department.status === 'active' && (
          <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full relative', colors.dot)}>
              <span className={cn('absolute inset-0 rounded-full animate-ping', colors.dot, 'opacity-75')} />
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active</span>
          </div>
        )}
        {department.status === 'partial' && (
          <span className="text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Partial</span>
        )}
      </div>

      {/* Agent avatars row (overlapping) */}
      <div className="flex items-center mb-4">
        <div className="flex -space-x-3">
          {agents.slice(0, 4).map((agent) => (
            <AgentAvatar key={agent.id} name={agent.name} photo={agent.photo} status={agent.status} size="sm" />
          ))}
          {agents.length > 4 && (
            <div className="w-8 h-8 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[10px] font-bold text-muted-foreground">
              +{agents.length - 4}
            </div>
          )}
        </div>
        <span className="ml-3 text-xs text-muted-foreground">
          {activeCount > 0 ? `${activeCount} agent${activeCount > 1 ? 's' : ''} active` : `${agents.length} agent${agents.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Stats line */}
      {stats?.today && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          {stats.today}
        </p>
      )}
    </div>
  );
};

export default DepartmentCard;
