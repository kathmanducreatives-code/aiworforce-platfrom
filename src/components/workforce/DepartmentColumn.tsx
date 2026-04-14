import AgentBadge from './AgentBadge';
import VacantSlot from './VacantSlot';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/* ─── Types ─── */

export interface DeptAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: 'active' | 'idle' | 'disabled';
  isOriginal?: boolean;
  enabledTools?: string[];
  lastActive?: string;
}

interface DepartmentColumnProps {
  department: {
    id: string;
    name: string;
    icon: LucideIcon;
    color: string;       // hex color e.g. '#10B981'
    glowColor: string;   // rgba glow string
    maxSlots: number;
  };
  agents: DeptAgent[];
  onAgentClick: (agentId: string) => void;
  onHireClick: (deptId: string) => void;
}

/* ─── Component ─── */

const DepartmentColumn = ({ department, agents, onAgentClick, onHireClick }: DepartmentColumnProps) => {
  const Icon = department.icon;
  const activeCount = agents.filter(a => a.status === 'active').length;
  const vacantSlots = Math.max(0, department.maxSlots - agents.length);

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl overflow-hidden',
        'bg-[rgba(255,255,255,0.02)] backdrop-blur-[16px] saturate-[140%]',
        'border border-[rgba(255,255,255,0.06)]',
        'transition-all duration-300 hover:border-[rgba(255,255,255,0.1)]',
      )}
    >
      {/* ─── Column Header ─── */}
      <div className="px-4 py-4 border-b border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: `${department.color}15`,
              border: `1px solid ${department.color}25`,
            }}
          >
            <Icon className="h-4 w-4" style={{ color: department.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-semibold text-white tracking-tight">{department.name}</h2>
            <p className="text-[10px] font-mono text-white/25 tracking-wider mt-0.5">
              {activeCount}/{agents.length} <span className="text-white/15">ONLINE</span>
            </p>
          </div>
          {/* Dept status indicator */}
          <div className="flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              {activeCount > 0 && (
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                  style={{ backgroundColor: department.color }}
                />
              )}
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ backgroundColor: activeCount > 0 ? department.color : 'rgba(255,255,255,0.15)' }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* ─── Agent List ─── */}
      <div className="flex-1 p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-380px)] scrollbar-thin scrollbar-thumb-white/5">
        {agents.map(agent => (
          <AgentBadge
            key={agent.id}
            agent={agent}
            deptColor={department.color}
            onClick={onAgentClick}
          />
        ))}

        {/* Vacant slots */}
        {Array.from({ length: vacantSlots }).map((_, i) => (
          <VacantSlot
            key={`vacant-${i}`}
            deptColor={department.color}
            onHire={() => onHireClick(department.id)}
          />
        ))}
      </div>

      {/* ─── Column Footer ─── */}
      <div className="px-4 py-2.5 border-t border-[rgba(255,255,255,0.03)]">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-white/15 tracking-wider">
            {agents.length} AGENTS · {vacantSlots} OPEN
          </span>
        </div>
      </div>
    </div>
  );
};

export default DepartmentColumn;
