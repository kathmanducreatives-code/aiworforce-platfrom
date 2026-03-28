import { Sparkles } from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import { DEPT_COLORS, getEmployeesByDepartment, type StudioEmployee, type StudioDepartment } from '@/data/agent-studio';
import { cn } from '@/lib/utils';

interface CoreAgentCardProps {
  employee: StudioEmployee;
  department: StudioDepartment;
  allEmployees: StudioEmployee[];
  onConfigure: (id: string) => void;
}

const CoreAgentCard = ({ employee, department, allEmployees, onConfigure }: CoreAgentCardProps) => {
  const colors = DEPT_COLORS[department.color] || DEPT_COLORS.teal;
  const deptEmployees = getEmployeesByDepartment(allEmployees, department.id);
  const activeCount = deptEmployees.filter(e => e.status === 'active').length;

  return (
    <div
      onClick={() => onConfigure(employee.id)}
      className="group relative cursor-pointer rounded-2xl border border-border/50 bg-card/20 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 overflow-hidden"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 40px ${colors.glow}, 0 0 0 1px ${colors.hex}15`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '';
      }}
    >
      {/* Accent gradient line */}
      <div className={cn('h-px w-full bg-gradient-to-r', colors.gradient)} />

      <div className="p-6">
        {/* Badge row */}
        <div className="flex items-center justify-between mb-5">
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border',
            colors.bg, colors.text, colors.border
          )}>
            <Sparkles className="h-2.5 w-2.5" />
            Core Agent
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full relative', colors.dot)}>
              <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', colors.dot)} />
            </span>
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {employee.status}
            </span>
          </div>
        </div>

        {/* Portrait */}
        <div className="flex justify-center mb-5">
          <div className="relative">
            <div className={cn('absolute -inset-1 rounded-full opacity-20 blur-sm', colors.dot)} />
            <AgentAvatar
              name={employee.name}
              photo={employee.avatar}
              status={employee.status}
              size="lg"
              className="!w-[72px] !h-[72px] relative"
            />
          </div>
        </div>

        {/* Identity */}
        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-foreground tracking-tight">{employee.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{employee.role}</p>
          <span className={cn(
            'inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border',
            colors.bg, colors.text, colors.border
          )}>
            {department.name}
          </span>
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted-foreground/50 text-center leading-relaxed line-clamp-2 mb-5 min-h-[32px]">
          {employee.description}
        </p>

        {/* Stats */}
        <div className="flex items-center justify-between pt-4 border-t border-border/30">
          <div className="text-center">
            <p className="text-sm font-bold text-foreground tabular-nums">{deptEmployees.length}</p>
            <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Agents</p>
          </div>
          <div className="w-px h-6 bg-border/30" />
          <div className="text-center">
            <p className="text-sm font-bold text-foreground tabular-nums">{employee.enabledTools.length}</p>
            <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Tools</p>
          </div>
          <div className="w-px h-6 bg-border/30" />
          <div className="text-center">
            <p className="text-sm font-bold text-foreground tabular-nums">{activeCount}</p>
            <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Active</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoreAgentCard;
