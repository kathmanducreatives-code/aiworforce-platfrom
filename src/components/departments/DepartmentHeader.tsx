import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import AgentAvatar from './AgentAvatar';
import { getAgentsByDepartment, getActiveAgentCount } from '@/data/agents';
import { DEPARTMENTS } from '@/data/departments';
import type { DepartmentId } from '@/data/agents';
import { cn } from '@/lib/utils';

interface DepartmentHeaderProps {
  departmentId: DepartmentId;
}

const DepartmentHeader = ({ departmentId }: DepartmentHeaderProps) => {
  const navigate = useNavigate();
  const dept = DEPARTMENTS.find(d => d.id === departmentId);
  const agents = getAgentsByDepartment(departmentId);
  const activeCount = getActiveAgentCount(departmentId);

  if (!dept) return null;

  return (
    <div className="mb-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <button onClick={() => navigate('/dashboard')} className="hover:text-foreground transition-colors">
          Command Center
        </button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{dept.name} Department</span>
      </div>

      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('p-2.5 rounded-xl bg-primary/10 border border-primary/20')}>
            <dept.icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{dept.name} Department</h1>
            <p className="text-sm text-muted-foreground">{activeCount} agent{activeCount !== 1 ? 's' : ''} active</p>
          </div>
        </div>
      </div>

      {/* Agent showcase row */}
      <div className="flex items-center gap-3 mt-4 overflow-x-auto pb-2">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border bg-card/50 flex-shrink-0"
          >
            <AgentAvatar name={agent.name} photo={agent.photo} status={agent.status} size="sm" />
            <div>
              <p className="text-xs font-semibold text-foreground">{agent.name}</p>
              <p className="text-[10px] text-muted-foreground">{agent.role}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DepartmentHeader;
