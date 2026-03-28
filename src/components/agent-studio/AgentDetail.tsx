import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Save, Sparkles, Plus, X,
  User, FileText, Wrench, GitBranch, Settings2,
} from 'lucide-react';
import AgentAvatar from '@/components/departments/AgentAvatar';
import PromptConfigurator from './PromptConfigurator';
import ToolModelSelector from './ToolModelSelector';
import {
  STUDIO_DEPARTMENTS, DEPT_COLORS, getDeptColors,
  type StudioEmployee, type StudioDeptId, type PromptConfig, type OutputPreferences,
} from '@/data/agent-studio';
import { cn } from '@/lib/utils';

interface AgentDetailProps {
  employee: StudioEmployee;
  allEmployees: StudioEmployee[];
  onSave: (employee: StudioEmployee) => void;
  onBack: () => void;
}

type TabId = 'role' | 'instructions' | 'tools' | 'collaboration' | 'output';

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: 'role', label: 'Role', icon: User },
  { id: 'instructions', label: 'Instructions', icon: FileText },
  { id: 'tools', label: 'Tools & Models', icon: Wrench },
  { id: 'collaboration', label: 'Collaboration', icon: GitBranch },
  { id: 'output', label: 'Output', icon: Settings2 },
];

const AgentDetail = ({ employee, allEmployees, onSave, onBack }: AgentDetailProps) => {
  const [draft, setDraft] = useState<StudioEmployee>({ ...employee });
  const [activeTab, setActiveTab] = useState<TabId>('role');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setDraft({
      ...employee,
      enabledTools: [...employee.enabledTools],
      collaboratesWith: [...employee.collaboratesWith],
      responsibilities: [...employee.responsibilities],
      prompt: { ...employee.prompt },
      outputPreferences: { ...employee.outputPreferences },
    });
    setHasChanges(false);
    setActiveTab('role');
  }, [employee.id]);

  const update = useCallback(<K extends keyof StudioEmployee>(key: K, value: StudioEmployee[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const dept = STUDIO_DEPARTMENTS.find(d => d.id === draft.department);
  const colors = DEPT_COLORS[dept?.color || 'teal'] || DEPT_COLORS.teal;
  const deptColor = dept?.color || 'teal';
  const sameDepAgents = allEmployees.filter(e => e.department === draft.department && e.id !== draft.id);

  const handleSave = () => {
    onSave(draft);
    setHasChanges(false);
  };

  return (
    <div className="animate-fade-in">
      {/* ─── Header ─── */}
      <div className="mb-8">
        {/* Back + actions */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Agent Studio</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all',
                hasChanges
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
                  : 'bg-muted/30 text-muted-foreground/30 cursor-not-allowed',
              )}
            >
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </button>
          </div>
        </div>

        {/* Agent identity */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className={cn('absolute -inset-1.5 rounded-full opacity-20 blur-md', colors.dot)} />
            <AgentAvatar
              name={draft.name}
              photo={draft.avatar}
              status={draft.status}
              size="lg"
              className="!w-[72px] !h-[72px] relative"
            />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{draft.name || 'New Agent'}</h1>
              {draft.isOriginal && (
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border',
                  colors.bg, colors.text, colors.border
                )}>
                  <Sparkles className="h-2.5 w-2.5" />
                  Core Agent
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{draft.role || 'Untitled role'}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border',
                colors.bg, colors.text, colors.border
              )}>
                <dept.icon className="h-3 w-3" />
                {dept?.name}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  draft.status === 'active' ? colors.dot : draft.status === 'idle' ? 'bg-amber-500' : 'bg-muted-foreground/20',
                )} />
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-medium">
                  {draft.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tab Navigation ─── */}
      <div className="flex items-center gap-1 border-b border-border/30 mb-8">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px',
                isActive
                  ? cn('text-foreground', `border-[${colors.hex}]`)
                  : 'text-muted-foreground/50 border-transparent hover:text-muted-foreground hover:border-border/30',
              )}
              style={isActive ? { borderBottomColor: colors.hex } : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ─── */}
      <div className="max-w-3xl">

        {/* Role Tab */}
        {activeTab === 'role' && (
          <div className="space-y-6 animate-fade-in">
            {/* General fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name" value={draft.name} onChange={(v) => update('name', v)} />
              <Field label="Role Title" value={draft.role} onChange={(v) => update('role', v)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">Department</label>
                <select
                  value={draft.department}
                  onChange={(e) => update('department', e.target.value as StudioDeptId)}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/30 bg-card/10 text-sm text-foreground focus:outline-none focus:border-border/60 transition-colors appearance-none cursor-pointer"
                >
                  {STUDIO_DEPARTMENTS.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">Status</label>
                <div className="flex gap-2">
                  {(['active', 'idle', 'disabled'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => update('status', s)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all flex-1 justify-center',
                        draft.status === s
                          ? cn(colors.bg, colors.border, 'text-foreground')
                          : 'border-border/20 text-muted-foreground/40 hover:border-border/40',
                      )}
                    >
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        s === 'active' ? 'bg-emerald-500' : s === 'idle' ? 'bg-amber-500' : 'bg-muted-foreground/30',
                      )} />
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">Description</label>
              <textarea
                value={draft.description}
                onChange={(e) => { update('description', e.target.value); }}
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border border-border/30 bg-card/10 text-sm text-foreground/80 leading-relaxed placeholder:text-muted-foreground/20 focus:outline-none focus:border-border/60 transition-colors resize-y"
                placeholder="What does this agent do?"
              />
            </div>

            {/* Responsibilities */}
            <div>
              <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">Responsibilities</label>
              <div className="space-y-2">
                {draft.responsibilities.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', colors.dot)} />
                    <input
                      value={r}
                      onChange={(e) => {
                        const updated = [...draft.responsibilities];
                        updated[i] = e.target.value;
                        update('responsibilities', updated);
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-border/20 bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-border/40 transition-colors"
                    />
                    <button
                      onClick={() => update('responsibilities', draft.responsibilities.filter((_, j) => j !== i))}
                      className="p-1 text-muted-foreground/20 hover:text-red-400 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => update('responsibilities', [...draft.responsibilities, ''])}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors"
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
            <div className="mb-4">
              <p className="text-sm text-muted-foreground/50 leading-relaxed">
                Define how this agent thinks and operates. These instructions shape every response and decision.
              </p>
            </div>
            <PromptConfigurator
              prompt={draft.prompt}
              onChange={(p: PromptConfig) => update('prompt', p)}
              deptColor={deptColor}
            />
          </div>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <div className="animate-fade-in">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground/50 leading-relaxed">
                Choose which AI models and tools this agent can access. More tools means more capability, but also more complexity.
              </p>
            </div>
            <ToolModelSelector
              selectedTools={draft.enabledTools}
              onChange={(tools) => update('enabledTools', tools)}
              deptColor={deptColor}
            />
          </div>
        )}

        {/* Collaboration Tab */}
        {activeTab === 'collaboration' && (
          <div className="animate-fade-in space-y-4">
            <p className="text-sm text-muted-foreground/50 leading-relaxed">
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
                        update('collaboratesWith',
                          isLinked
                            ? draft.collaboratesWith.filter(id => id !== agent.id)
                            : [...draft.collaboratesWith, agent.id]
                        );
                      }}
                      className={cn(
                        'flex items-center gap-4 w-full p-4 rounded-xl border text-left transition-all',
                        isLinked
                          ? cn(colors.bg, colors.border, 'ring-1', colors.ring)
                          : 'border-border/20 hover:border-border/40',
                      )}
                    >
                      <AgentAvatar name={agent.name} photo={agent.avatar} status={agent.status} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-semibold', isLinked ? 'text-foreground' : 'text-muted-foreground/60')}>
                          {agent.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground/40">{agent.role}</p>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                        isLinked ? cn(colors.border, colors.dot, 'border-transparent') : 'border-border/40',
                      )}>
                        {isLinked && <span className="w-2 h-2 rounded-sm bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground/30 text-sm">
                No other agents in this department yet.
              </div>
            )}
          </div>
        )}

        {/* Output Tab */}
        {activeTab === 'output' && (
          <div className="animate-fade-in space-y-6">
            <p className="text-sm text-muted-foreground/50 leading-relaxed">
              Configure how this agent delivers its work. These preferences shape the format, depth, and action-orientation of every output.
            </p>

            <OutputSection
              label="Response Format"
              hint="How should this agent structure its responses?"
              options={[
                { value: 'detailed', label: 'Detailed', desc: 'Thorough analysis with full context' },
                { value: 'concise', label: 'Concise', desc: 'Key points only, minimal prose' },
                { value: 'structured', label: 'Structured', desc: 'Organized sections with headers' },
                { value: 'conversational', label: 'Conversational', desc: 'Natural, dialogue-style responses' },
              ]}
              value={draft.outputPreferences.format}
              onChange={(v) => update('outputPreferences', { ...draft.outputPreferences, format: v as OutputPreferences['format'] })}
              deptColor={deptColor}
            />

            <OutputSection
              label="Summary Depth"
              hint="How much detail should summaries contain?"
              options={[
                { value: 'brief', label: 'Brief', desc: 'Headlines and key takeaways' },
                { value: 'standard', label: 'Standard', desc: 'Balanced detail and brevity' },
                { value: 'comprehensive', label: 'Comprehensive', desc: 'Full analysis with supporting data' },
              ]}
              value={draft.outputPreferences.summaryDepth}
              onChange={(v) => update('outputPreferences', { ...draft.outputPreferences, summaryDepth: v as OutputPreferences['summaryDepth'] })}
              deptColor={deptColor}
            />

            <OutputSection
              label="Action Orientation"
              hint="How should this agent approach decisions and recommendations?"
              options={[
                { value: 'advisory', label: 'Advisory', desc: 'Recommend options, let humans decide' },
                { value: 'directive', label: 'Directive', desc: 'Give clear recommended actions' },
                { value: 'autonomous', label: 'Autonomous', desc: 'Act independently within boundaries' },
              ]}
              value={draft.outputPreferences.actionOrientation}
              onChange={(v) => update('outputPreferences', { ...draft.outputPreferences, actionOrientation: v as OutputPreferences['actionOrientation'] })}
              deptColor={deptColor}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Helper Components ───

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl border border-border/30 bg-card/10 text-sm text-foreground placeholder:text-muted-foreground/20 focus:outline-none focus:border-border/60 transition-colors"
      />
    </div>
  );
}

function OutputSection({ label, hint, options, value, onChange, deptColor }: {
  label: string; hint: string;
  options: { value: string; label: string; desc: string }[];
  value: string; onChange: (v: string) => void;
  deptColor: string;
}) {
  const colors = DEPT_COLORS[deptColor] || DEPT_COLORS.teal;
  return (
    <div>
      <label className="block text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-1">{label}</label>
      <p className="text-[11px] text-muted-foreground/30 mb-3">{hint}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'p-3 rounded-xl border text-left transition-all',
              value === opt.value
                ? cn(colors.bg, colors.border, 'ring-1', colors.ring)
                : 'border-border/20 hover:border-border/40',
            )}
          >
            <p className={cn('text-sm font-medium', value === opt.value ? 'text-foreground' : 'text-muted-foreground/60')}>
              {opt.label}
            </p>
            <p className="text-[10px] text-muted-foreground/30 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default AgentDetail;
