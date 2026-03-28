import { useState, useMemo } from 'react';
import { Bot, Plus, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import CoreAgentCard from '@/components/agent-studio/CoreAgentCard';
import AgentCard from '@/components/agent-studio/AgentCard';
import AgentDetail from '@/components/agent-studio/AgentDetail';
import AgentAvatar from '@/components/departments/AgentAvatar';
import {
  STUDIO_DEPARTMENTS, DEFAULT_EMPLOYEES, DEPT_COLORS,
  getEmployeesByDepartment, generateId, getDeptColors,
  type StudioEmployee, type StudioDeptId,
} from '@/data/agent-studio';
import { cn } from '@/lib/utils';

type View = 'overview' | 'detail';

const AgentStudio = () => {
  const [employees, setEmployees] = useState<StudioEmployee[]>(DEFAULT_EMPLOYEES);
  const [view, setView] = useState<View>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>(
    Object.fromEntries(STUDIO_DEPARTMENTS.map(d => [d.id, true]))
  );

  const selectedEmployee = useMemo(
    () => employees.find(e => e.id === selectedId) || null,
    [employees, selectedId]
  );

  const coreAgents = useMemo(
    () => employees.filter(e => e.isOriginal),
    [employees]
  );

  // ─── Stats ───
  const totalAgents = employees.length;
  const activeAgents = employees.filter(e => e.status === 'active').length;
  const totalTools = new Set(employees.flatMap(e => e.enabledTools)).size;

  // ─── Handlers ───
  const openDetail = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const handleSave = (updated: StudioEmployee) => {
    setEmployees(prev => {
      const exists = prev.some(e => e.id === updated.id);
      return exists
        ? prev.map(e => e.id === updated.id ? updated : e)
        : [...prev, updated];
    });
    setView('overview');
    setSelectedId(null);
  };

  const handleBack = () => {
    setView('overview');
    setSelectedId(null);
  };

  const handleAddAgent = (deptId: StudioDeptId) => {
    const newAgent: StudioEmployee = {
      id: generateId(),
      name: '',
      role: '',
      department: deptId,
      avatar: '',
      status: 'disabled',
      description: '',
      prompt: { system: '', objectives: '', tone: '', constraints: '', escalation: '', outputStyle: '' },
      enabledTools: ['claude'],
      collaboratesWith: [],
      responsibilities: [],
      lastUpdated: 'Just now',
      outputPreferences: { format: 'structured', summaryDepth: 'standard', actionOrientation: 'advisory' },
    };
    setEmployees(prev => [...prev, newAgent]);
    openDetail(newAgent.id);
  };

  const toggleDept = (deptId: string) => {
    setExpandedDepts(prev => ({ ...prev, [deptId]: !prev[deptId] }));
  };

  // ════════════════════════════════════════════════════════════════
  // Detail View
  // ════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedEmployee) {
    return (
      <div className="min-h-screen bg-transparent">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-8 py-6">
          <AgentDetail
            employee={selectedEmployee}
            allEmployees={employees}
            onSave={handleSave}
            onBack={handleBack}
          />
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // Overview
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-8 py-6">

        {/* ─── Hero Header ─── */}
        <div className="relative mb-10">
          {/* Ambient glow */}
          <div className="absolute -top-32 left-1/4 w-96 h-96 bg-primary/[0.03] rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -top-20 right-1/4 w-64 h-64 bg-violet-500/[0.03] rounded-full blur-[80px] pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                  Agent Studio
                </h1>
              </div>
              <p className="text-sm text-muted-foreground/60 max-w-lg leading-relaxed">
                Build, configure, and orchestrate your AI workforce. Assign agents to departments,
                equip them with tools, and define how they collaborate to automate your operations.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => handleAddAgent('talent')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
              >
                <Plus className="h-4 w-4" />
                Create Agent
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-6 mt-6 pt-6 border-t border-border/20">
            {[
              { label: 'Agents', value: totalAgents },
              { label: 'Active', value: activeAgents },
              { label: 'Departments', value: STUDIO_DEPARTMENTS.length },
              { label: 'Tools Available', value: totalTools },
            ].map(stat => (
              <div key={stat.label} className="flex items-center gap-2">
                <span className="text-lg font-bold text-foreground tabular-nums">{stat.value}</span>
                <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Core Platform Agents ─── */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <Sparkles className="h-4 w-4 text-primary/60" />
            <h2 className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em]">
              Core Platform Agents
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {coreAgents.map(agent => {
              const dept = STUDIO_DEPARTMENTS.find(d => d.id === agent.department)!;
              return (
                <CoreAgentCard
                  key={agent.id}
                  employee={agent}
                  department={dept}
                  allEmployees={employees}
                  onConfigure={openDetail}
                />
              );
            })}
          </div>
        </section>

        {/* ─── Department Workforce ─── */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em]">
              Departments
            </h2>
          </div>

          <div className="space-y-3">
            {STUDIO_DEPARTMENTS.map(dept => {
              const deptEmployees = getEmployeesByDepartment(employees, dept.id);
              const deptActive = deptEmployees.filter(e => e.status === 'active').length;
              const isExpanded = expandedDepts[dept.id] ?? true;
              const colors = DEPT_COLORS[dept.color] || DEPT_COLORS.teal;
              const Icon = dept.icon;

              return (
                <div
                  key={dept.id}
                  className="rounded-2xl border border-border/30 bg-card/10 backdrop-blur-sm overflow-hidden transition-all"
                >
                  {/* Department header */}
                  <button
                    onClick={() => toggleDept(dept.id)}
                    className="w-full flex items-center gap-4 px-6 py-5 hover:bg-muted/5 transition-colors text-left group"
                  >
                    <div className={cn('p-2.5 rounded-xl border', colors.bg, colors.border)}>
                      <Icon className={cn('h-5 w-5', colors.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-bold text-foreground">{dept.name}</h3>
                        <span className="text-[10px] text-muted-foreground/30 tabular-nums">
                          {deptEmployees.length} agent{deptEmployees.length !== 1 ? 's' : ''}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className={cn('w-1.5 h-1.5 rounded-full', deptActive > 0 ? colors.dot : 'bg-muted-foreground/20')} />
                          <span className="text-[10px] text-muted-foreground/30">{deptActive} active</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground/40 mt-0.5">{dept.description}</p>
                    </div>

                    {/* Stacked avatars preview */}
                    <div className="hidden sm:flex -space-x-2 mr-4">
                      {deptEmployees.slice(0, 4).map(e => (
                        <AgentAvatar key={e.id} name={e.name} photo={e.avatar} status={e.status} size="sm" />
                      ))}
                    </div>

                    <div className="text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </button>

                  {/* Department content */}
                  {isExpanded && (
                    <div className="px-6 pb-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {deptEmployees.map(emp => (
                          <AgentCard key={emp.id} employee={emp} onClick={openDetail} />
                        ))}

                        {/* Add agent */}
                        <button
                          onClick={() => handleAddAgent(dept.id)}
                          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/30 p-6 text-muted-foreground/25 hover:text-muted-foreground/50 hover:border-border/50 hover:bg-muted/5 transition-all min-h-[140px]"
                        >
                          <Plus className="h-5 w-5" />
                          <span className="text-xs font-medium">Add Agent</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AgentStudio;
