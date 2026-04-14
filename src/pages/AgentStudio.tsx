import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot, Plus, Save, Sparkles, ArrowLeft,
  User, FileText, Wrench, GitBranch, Settings2,
  Search, ChevronDown, Power, X,
} from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import PromptConfigurator from '@/components/agent-studio/PromptConfigurator';
import ToolModelSelector from '@/components/agent-studio/ToolModelSelector';
import {
  STUDIO_DEPARTMENTS, DEFAULT_EMPLOYEES, DEPT_COLORS,
  getEmployeesByDepartment, generateId, getDeptColors,
  type StudioEmployee, type StudioDeptId, type PromptConfig, type OutputPreferences,
} from '@/data/agent-studio';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Tab Definitions
   ═══════════════════════════════════════════════════════════════ */

type TabId = 'role' | 'instructions' | 'tools' | 'collaboration' | 'output';

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: 'role', label: 'Identity', icon: User },
  { id: 'instructions', label: 'Prompts', icon: FileText },
  { id: 'tools', label: 'Arsenal', icon: Wrench },
  { id: 'collaboration', label: 'Collab', icon: GitBranch },
  { id: 'output', label: 'Output', icon: Settings2 },
];

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

const AgentStudio = () => {
  const [searchParams] = useSearchParams();
  const [employees, setEmployees] = useState<StudioEmployee[]>(DEFAULT_EMPLOYEES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('role');
  const [hasChanges, setHasChanges] = useState(false);
  const [deptFilter, setDeptFilter] = useState<StudioDeptId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Deep-link support: ?agent=scout or ?dept=talent&mode=create
  useEffect(() => {
    const agentParam = searchParams.get('agent');
    const deptParam = searchParams.get('dept') as StudioDeptId | null;
    const modeParam = searchParams.get('mode');

    if (agentParam) {
      const found = employees.find(e => e.id === agentParam);
      if (found) {
        setSelectedId(found.id);
        return;
      }
    }
    if (deptParam && modeParam === 'create') {
      handleAddAgent(deptParam);
    }
  }, []);

  // ─── Derived State ───
  const selectedEmployee = useMemo(
    () => employees.find(e => e.id === selectedId) || null,
    [employees, selectedId]
  );

  const [draft, setDraft] = useState<StudioEmployee | null>(null);

  useEffect(() => {
    if (selectedEmployee) {
      setDraft({
        ...selectedEmployee,
        enabledTools: [...selectedEmployee.enabledTools],
        collaboratesWith: [...selectedEmployee.collaboratesWith],
        responsibilities: [...selectedEmployee.responsibilities],
        prompt: { ...selectedEmployee.prompt },
        outputPreferences: { ...selectedEmployee.outputPreferences },
      });
      setHasChanges(false);
      setActiveTab('role');
    } else {
      setDraft(null);
    }
  }, [selectedEmployee?.id]);

  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (deptFilter !== 'all') {
      list = list.filter(e => e.department === deptFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q));
    }
    return list;
  }, [employees, deptFilter, searchQuery]);

  // Group by department for sidebar
  const groupedByDept = useMemo(() => {
    const groups: Record<string, StudioEmployee[]> = {};
    for (const dept of STUDIO_DEPARTMENTS) {
      const matches = filteredEmployees.filter(e => e.department === dept.id);
      if (matches.length > 0) groups[dept.id] = matches;
    }
    return groups;
  }, [filteredEmployees]);

  // Stats
  const totalAgents = employees.length;
  const activeAgents = employees.filter(e => e.status === 'active').length;

  // ─── Handlers ───
  const updateDraft = <K extends keyof StudioEmployee>(key: K, value: StudioEmployee[K]) => {
    if (!draft) return;
    setDraft(prev => prev ? { ...prev, [key]: value } : null);
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!draft) return;
    setEmployees(prev => {
      const exists = prev.some(e => e.id === draft.id);
      return exists ? prev.map(e => e.id === draft.id ? draft : e) : [...prev, draft];
    });
    setHasChanges(false);
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
    setSelectedId(newAgent.id);
  };

  const dept = draft ? STUDIO_DEPARTMENTS.find(d => d.id === draft.department) : null;
  const colors = DEPT_COLORS[dept?.color || 'teal'] || DEPT_COLORS.teal;
  const deptColor = dept?.color || 'teal';
  const sameDepAgents = draft ? employees.filter(e => e.department === draft.department && e.id !== draft.id) : [];

  /* ═══════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="h-full flex flex-col bg-transparent">

      {/* ─── Studio Header Bar ─── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[rgba(0,255,148,0.08)] border border-[rgba(0,255,148,0.12)]">
            <Bot className="h-5 w-5 text-[#00FF94]/70" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Agent Studio</h1>
            <p className="text-[10px] font-mono text-white/25 tracking-wider">
              {totalAgents} AGENTS · {activeAgents} ACTIVE · {STUDIO_DEPARTMENTS.length} DEPARTMENTS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[rgba(0,255,148,0.12)] border border-[rgba(0,255,148,0.2)] text-[#00FF94] text-xs font-semibold hover:bg-[rgba(0,255,148,0.18)] transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </button>
          )}
          <button
            onClick={() => handleAddAgent('talent')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-white/50 text-xs font-medium hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Agent
          </button>
        </div>
      </div>

      {/* ─── 3-Column Layout ─── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ══════════════════════════════════════════════════════
           Column 1: Roster (270px)
           ══════════════════════════════════════════════════════ */}
        <div className="w-[270px] flex-shrink-0 border-r border-[rgba(255,255,255,0.04)] flex flex-col bg-[rgba(255,255,255,0.01)]">

          {/* Search + Filter */}
          <div className="p-3 border-b border-[rgba(255,255,255,0.04)] space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
              <input
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-xs text-white/70 placeholder:text-white/15 focus:outline-none focus:border-[rgba(0,255,148,0.2)] transition-colors"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              <FilterChip active={deptFilter === 'all'} onClick={() => setDeptFilter('all')}>All</FilterChip>
              {STUDIO_DEPARTMENTS.map(d => (
                <FilterChip key={d.id} active={deptFilter === d.id} onClick={() => setDeptFilter(d.id)}>
                  {d.name.split(' ')[0]}
                </FilterChip>
              ))}
            </div>
          </div>

          {/* Agent List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/5">
            {Object.entries(groupedByDept).map(([deptId, agents]) => {
              const deptDef = STUDIO_DEPARTMENTS.find(d => d.id === deptId)!;
              const deptColors = DEPT_COLORS[deptDef.color] || DEPT_COLORS.teal;
              const DeptIcon = deptDef.icon;
              return (
                <div key={deptId} className="border-b border-[rgba(255,255,255,0.02)]">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <DeptIcon className={cn('h-3 w-3', deptColors.text)} />
                    <span className="text-[9px] font-mono text-white/25 tracking-[0.15em] uppercase">{deptDef.name}</span>
                    <span className="text-[9px] font-mono text-white/12 ml-auto">{agents.length}</span>
                  </div>
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedId(agent.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150',
                        selectedId === agent.id
                          ? 'bg-[rgba(0,255,148,0.04)] border-l-2 border-[#00FF94]'
                          : 'hover:bg-[rgba(255,255,255,0.02)] border-l-2 border-transparent'
                      )}
                    >
                      <div className="relative flex-shrink-0">
                        {agent.avatar ? (
                          <img
                            src={agent.avatar}
                            alt={agent.name}
                            className="w-8 h-8 rounded-full object-cover"
                            style={{
                              border: agent.status === 'active'
                                ? `2px solid ${deptColors.hex}50`
                                : '2px solid rgba(255,255,255,0.06)',
                            }}
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{
                              backgroundColor: `${deptColors.hex}15`,
                              border: `2px solid ${deptColors.hex}30`,
                              color: `${deptColors.hex}80`,
                            }}
                          >
                            {agent.name?.[0] || '?'}
                          </div>
                        )}
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a0f0d]"
                          style={{
                            backgroundColor:
                              agent.status === 'active' ? '#10B981'
                              : agent.status === 'idle' ? '#F59E0B'
                              : 'rgba(255,255,255,0.15)',
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'text-xs font-semibold truncate',
                            selectedId === agent.id ? 'text-white' : 'text-white/60'
                          )}>
                            {agent.name || 'New Agent'}
                          </span>
                          {agent.isOriginal && (
                            <Sparkles className="h-2.5 w-2.5 text-[#00FF94]/40 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-[10px] text-white/20 truncate">{agent.role || 'Unassigned'}</p>
                      </div>
                    </button>
                  ))}

                  {/* Add to this department */}
                  <button
                    onClick={() => handleAddAgent(deptId as StudioDeptId)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-white/15 hover:text-white/30 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add to {deptDef.name.split(' ')[0]}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
           Column 2: Configuration Matrix (flex-1)
           ══════════════════════════════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {draft ? (
            <>
              {/* Identity Banner */}
              <div className="flex items-center gap-4 px-6 py-4 border-b border-[rgba(255,255,255,0.04)]">
                <div className="relative">
                  {draft.isOriginal && (
                    <div
                      className="absolute -inset-1 rounded-full opacity-25 animate-[rim-pulse_4s_ease-in-out_infinite]"
                      style={{ border: `2px solid ${colors.hex}`, boxShadow: `0 0 16px ${colors.hex}30` }}
                    />
                  )}
                  {draft.avatar ? (
                    <img
                      src={draft.avatar}
                      alt={draft.name}
                      className="w-14 h-14 rounded-full object-cover relative z-10"
                      style={{ border: `2px solid ${colors.hex}40` }}
                    />
                  ) : (
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold relative z-10"
                      style={{ backgroundColor: `${colors.hex}15`, border: `2px solid ${colors.hex}30`, color: `${colors.hex}80` }}
                    >
                      {draft.name?.[0] || '?'}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">{draft.name || 'New Agent'}</h2>
                    {draft.isOriginal && (
                      <span className="text-[8px] font-mono tracking-[0.2em] px-1.5 py-0.5 rounded bg-[rgba(0,255,148,0.06)] text-[#00FF94]/50 border border-[rgba(0,255,148,0.1)]">
                        ORIGINAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/30 mt-0.5">{draft.role || 'Untitled role'}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span
                      className="text-[9px] font-mono tracking-wider px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${colors.hex}10`,
                        color: `${colors.hex}80`,
                        border: `1px solid ${colors.hex}20`,
                      }}
                    >
                      {dept?.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            draft.status === 'active' ? '#10B981'
                            : draft.status === 'idle' ? '#F59E0B'
                            : 'rgba(255,255,255,0.2)',
                        }}
                      />
                      <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider">{draft.status}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tab Bar */}
              <div className="flex items-center gap-0.5 px-6 border-b border-[rgba(255,255,255,0.04)]">
                {TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-3 text-[11px] font-medium transition-all border-b-2 -mb-px',
                        isActive
                          ? 'text-white border-[#00FF94]/60'
                          : 'text-white/25 border-transparent hover:text-white/40',
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin scrollbar-thumb-white/5">
                <div className="max-w-2xl">

                  {/* Role Tab */}
                  {activeTab === 'role' && (
                    <div className="space-y-5 animate-fade-in">
                      <div className="grid grid-cols-2 gap-4">
                        <StudioField label="Name" value={draft.name} onChange={v => updateDraft('name', v)} />
                        <StudioField label="Role Title" value={draft.role} onChange={v => updateDraft('role', v)} />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">Department</label>
                          <select
                            value={draft.department}
                            onChange={(e) => updateDraft('department', e.target.value as StudioDeptId)}
                            className="w-full px-3 py-2.5 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-xs text-white/70 focus:outline-none focus:border-[rgba(0,255,148,0.2)] transition-colors appearance-none cursor-pointer"
                          >
                            {STUDIO_DEPARTMENTS.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">Status</label>
                          <div className="flex gap-1.5">
                            {(['active', 'idle', 'disabled'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => updateDraft('status', s)}
                                className={cn(
                                  'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[10px] font-medium transition-all flex-1 justify-center',
                                  draft.status === s
                                    ? 'border-[rgba(0,255,148,0.2)] bg-[rgba(0,255,148,0.05)] text-white/70'
                                    : 'border-[rgba(255,255,255,0.04)] text-white/20 hover:border-[rgba(255,255,255,0.08)]',
                                )}
                              >
                                <span className={cn(
                                  'w-1.5 h-1.5 rounded-full',
                                  s === 'active' ? 'bg-emerald-500' : s === 'idle' ? 'bg-amber-500' : 'bg-white/20',
                                )} />
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">Description</label>
                        <textarea
                          value={draft.description}
                          onChange={(e) => updateDraft('description', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2.5 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-xs text-white/60 leading-relaxed placeholder:text-white/10 focus:outline-none focus:border-[rgba(0,255,148,0.2)] transition-colors resize-y"
                          placeholder="What does this agent do?"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">Responsibilities</label>
                        <div className="space-y-1.5">
                          {draft.responsibilities.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: `${colors.hex}50` }} />
                              <input
                                value={r}
                                onChange={(e) => {
                                  const updated = [...draft.responsibilities];
                                  updated[i] = e.target.value;
                                  updateDraft('responsibilities', updated);
                                }}
                                className="flex-1 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.04)] bg-transparent text-xs text-white/50 focus:outline-none focus:border-[rgba(0,255,148,0.15)] transition-colors"
                              />
                              <button
                                onClick={() => updateDraft('responsibilities', draft.responsibilities.filter((_, j) => j !== i))}
                                className="p-1 text-white/10 hover:text-red-400/60 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => updateDraft('responsibilities', [...draft.responsibilities, ''])}
                            className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-white/15 hover:text-white/30 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add responsibility
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Instructions Tab */}
                  {activeTab === 'instructions' && (
                    <div className="animate-fade-in">
                      <p className="text-[11px] text-white/20 mb-4 leading-relaxed">
                        Define how this agent thinks and operates. These instructions shape every response and decision.
                      </p>
                      <PromptConfigurator
                        prompt={draft.prompt}
                        onChange={(p: PromptConfig) => updateDraft('prompt', p)}
                        deptColor={deptColor}
                      />
                    </div>
                  )}

                  {/* Tools Tab */}
                  {activeTab === 'tools' && (
                    <div className="animate-fade-in">
                      <p className="text-[11px] text-white/20 mb-4 leading-relaxed">
                        Equip this agent with the tools and AI models it needs to perform its role.
                      </p>
                      <ToolModelSelector
                        selectedTools={draft.enabledTools}
                        onChange={(tools) => updateDraft('enabledTools', tools)}
                        deptColor={deptColor}
                      />
                    </div>
                  )}

                  {/* Collaboration Tab */}
                  {activeTab === 'collaboration' && (
                    <div className="animate-fade-in space-y-4">
                      <p className="text-[11px] text-white/20 leading-relaxed">
                        Define which agents this employee collaborates with inside the {dept?.name} department.
                      </p>
                      {sameDepAgents.length > 0 ? (
                        <div className="space-y-2">
                          {sameDepAgents.map(agent => {
                            const isLinked = draft.collaboratesWith.includes(agent.id);
                            return (
                              <button
                                key={agent.id}
                                onClick={() => {
                                  updateDraft('collaboratesWith',
                                    isLinked
                                      ? draft.collaboratesWith.filter(id => id !== agent.id)
                                      : [...draft.collaboratesWith, agent.id]
                                  );
                                }}
                                className={cn(
                                  'flex items-center gap-3 w-full p-3 rounded-lg border text-left transition-all',
                                  isLinked
                                    ? 'border-[rgba(0,255,148,0.15)] bg-[rgba(0,255,148,0.03)]'
                                    : 'border-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.08)]',
                                )}
                              >
                                <AgentAvatar name={agent.name} photo={agent.avatar} status={agent.status} size="sm" />
                                <div className="flex-1 min-w-0">
                                  <p className={cn('text-xs font-semibold', isLinked ? 'text-white/70' : 'text-white/30')}>{agent.name}</p>
                                  <p className="text-[10px] text-white/15">{agent.role}</p>
                                </div>
                                <div className={cn(
                                  'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
                                  isLinked ? 'border-[#00FF94]/50 bg-[#00FF94]/10' : 'border-white/10',
                                )}>
                                  {isLinked && <span className="w-1.5 h-1.5 rounded-sm bg-[#00FF94]/70" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-white/15 text-xs">
                          No other agents in this department yet.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Output Tab */}
                  {activeTab === 'output' && (
                    <div className="animate-fade-in space-y-5">
                      <p className="text-[11px] text-white/20 leading-relaxed">
                        Configure how this agent delivers its work.
                      </p>
                      <OutputPref
                        label="Response Format"
                        options={[
                          { value: 'detailed', label: 'Detailed', desc: 'Full context' },
                          { value: 'concise', label: 'Concise', desc: 'Key points' },
                          { value: 'structured', label: 'Structured', desc: 'Headers & sections' },
                          { value: 'conversational', label: 'Conversational', desc: 'Natural dialogue' },
                        ]}
                        value={draft.outputPreferences.format}
                        onChange={(v) => updateDraft('outputPreferences', { ...draft.outputPreferences, format: v as OutputPreferences['format'] })}
                      />
                      <OutputPref
                        label="Summary Depth"
                        options={[
                          { value: 'brief', label: 'Brief', desc: 'Headlines' },
                          { value: 'standard', label: 'Standard', desc: 'Balanced' },
                          { value: 'comprehensive', label: 'Comprehensive', desc: 'Full analysis' },
                        ]}
                        value={draft.outputPreferences.summaryDepth}
                        onChange={(v) => updateDraft('outputPreferences', { ...draft.outputPreferences, summaryDepth: v as OutputPreferences['summaryDepth'] })}
                      />
                      <OutputPref
                        label="Action Orientation"
                        options={[
                          { value: 'advisory', label: 'Advisory', desc: 'Recommend options' },
                          { value: 'directive', label: 'Directive', desc: 'Clear actions' },
                          { value: 'autonomous', label: 'Autonomous', desc: 'Act independently' },
                        ]}
                        value={draft.outputPreferences.actionOrientation}
                        onChange={(v) => updateDraft('outputPreferences', { ...draft.outputPreferences, actionOrientation: v as OutputPreferences['actionOrientation'] })}
                      />
                    </div>
                  )}

                </div>
              </div>
            </>
          ) : (
            /* ─── Empty State ─── */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[rgba(0,255,148,0.04)] border border-[rgba(0,255,148,0.08)] flex items-center justify-center">
                  <Bot className="h-7 w-7 text-[#00FF94]/20" />
                </div>
                <h3 className="text-sm font-semibold text-white/30 mb-1">Select an Agent</h3>
                <p className="text-[11px] text-white/15 max-w-[200px]">
                  Choose an agent from the roster to view and edit their configuration.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Helper Components
   ═══════════════════════════════════════════════════════════════ */

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-md text-[10px] font-medium transition-all',
        active
          ? 'bg-[rgba(0,255,148,0.08)] text-[#00FF94]/60 border border-[rgba(0,255,148,0.15)]'
          : 'text-white/20 border border-transparent hover:text-white/30 hover:bg-[rgba(255,255,255,0.02)]',
      )}
    >
      {children}
    </button>
  );
}

function StudioField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-xs text-white/70 placeholder:text-white/10 focus:outline-none focus:border-[rgba(0,255,148,0.2)] transition-colors"
      />
    </div>
  );
}

function OutputPref({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string; desc: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] mb-2">{label}</label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'p-2.5 rounded-lg border text-left transition-all',
              value === opt.value
                ? 'border-[rgba(0,255,148,0.15)] bg-[rgba(0,255,148,0.03)]'
                : 'border-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.08)]',
            )}
          >
            <p className={cn('text-xs font-medium', value === opt.value ? 'text-white/60' : 'text-white/25')}>{opt.label}</p>
            <p className="text-[9px] text-white/12 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default AgentStudio;
