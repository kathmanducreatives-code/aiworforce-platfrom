import { useMemo, useState, useEffect } from 'react';
import { X, Play, Wrench, ShieldCheck, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import AgentAvatar from './AgentAvatar';
import {
  type WorkflowDefinition,
  missingCapabilities,
  resolveStatus,
} from '@/lib/workflows/registry';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import { TOOL_LABELS, type ToolKey } from '@/lib/workflows/tools';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';

interface Props {
  workflow: WorkflowDefinition | null;
  open: boolean;
  onClose: () => void;
  onRun: (workflow: WorkflowDefinition, values: Record<string, string | number | string[]>) => Promise<void> | void;
}

export default function WorkflowConfigPanel({ workflow, open, onClose, onRun }: Props) {
  const tools = useToolAvailability();
  const { data: brain } = useCompanyBrain();
  const [values, setValues] = useState<Record<string, string | number | string[]>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!workflow) return;
    const initial: Record<string, string | number | string[]> = {};
    const company = (brain?.profile?.company || {}) as any;
    const icp = (brain?.profile?.icp || {}) as any;
    const competitors = (brain?.profile?.competitors || {}) as any;

    workflow.fields.forEach((f) => {
      // Best-effort pre-fill from Company Brain
      let val = f.defaultValue;
      if (workflow.id === 'find_hiring_signal_accounts') {
        if (f.id === 'industry' && company.industry) val = company.industry;
        if (f.id === 'location' && company.location) val = company.location;
        if (f.id === 'stage' && company.stage) val = company.stage;
      } else if (workflow.id === 'find_icp_accounts') {
        if (f.id === 'category' && company.category) val = company.category;
        if (f.id === 'persona' && icp.buyer_roles?.[0]) val = icp.buyer_roles[0];
        if (f.id === 'industry' && company.industry) val = company.industry;
        if (f.id === 'location' && company.location) val = company.location;
      } else if (workflow.id === 'website_audit') {
        if (f.id === 'url' && company.website_url) val = company.website_url;
      } else if (workflow.id === 'research_company') {
        if (f.id === 'domain' && company.website_url) val = company.website_url;
      } else if (workflow.id === 'competitor_snapshot') {
        if (f.id === 'domain' && competitors.known?.[0]) val = competitors.known[0];
      }

      if (val !== undefined) initial[f.id] = val;
      else if (f.type === 'number') initial[f.id] = 0;
      else initial[f.id] = '';
    });
    setValues(initial);
  }, [workflow, brain]);

  const status = useMemo(
    () => (workflow ? resolveStatus(workflow, tools) : 'ready'),
    [workflow, tools]
  );
  const missing = useMemo(
    () => (workflow ? missingCapabilities(workflow, tools) : []),
    [workflow, tools]
  );

  if (!workflow) return null;

  const canRun = status === 'ready';
  const requiredOk = workflow.fields
    .filter((f) => f.required)
    .every((f) => {
      const v = values[f.id];
      return v !== undefined && v !== null && String(v).trim().length > 0;
    });

  const handleRun = async () => {
    if (!canRun || !requiredOk) return;
    setRunning(true);
    try {
      await onRun(workflow, values);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="bg-[#070707]/95 backdrop-blur-2xl border border-white/[0.06] text-foreground max-w-xl p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {workflow.agents.map((a) => (
                <AgentAvatar key={a} agentId={a} size={22} />
              ))}
              <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                {workflow.agents.map((a) => AGENT_BY_ID[a]?.name || a).join(' → ')}
              </span>
            </div>
            <h2 className="text-[15px] font-medium text-foreground leading-tight truncate">{workflow.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-neutral-500 hover:text-foreground hover:bg-white/[0.05]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          <p className="text-[12.5px] text-neutral-400 leading-relaxed">{workflow.description}</p>

          {status === 'setup_needed' && (
            <div className="flex gap-2 items-start text-[12px] p-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] text-amber-300">
              <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium mb-0.5">Setup needed</div>
                <div className="text-amber-200/80">
                  This workflow needs {missing.map((m) => TOOL_LABELS[m as ToolKey] || m).join(', ')} before it can run.
                </div>
              </div>
            </div>
          )}
          {status === 'coming_soon' && (
            <div className="text-[12px] p-3 rounded-lg border border-white/10 bg-white/[0.02] text-neutral-400">
              This playbook is on the roadmap and isn't available yet.
            </div>
          )}

          {workflow.fields.length > 0 && (
            <div className="space-y-3">
              {workflow.fields.map((f) => (
                <div key={f.id} className="space-y-1.5">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                    {f.label}{f.required && <span className="text-amber-400 ml-0.5">*</span>}
                  </label>
                  {f.type === 'select' && f.options ? (
                    <select
                      value={String(values[f.id] ?? '')}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      className="w-full h-9 px-3 rounded-md bg-white/[0.03] border border-white/[0.08] text-[13px] text-foreground focus:outline-none focus:border-emerald-500/40"
                    >
                      {!f.required && <option value="">—</option>}
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value} className="bg-[#0a0a0a]">{o.label}</option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      value={String(values[f.id] ?? '')}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      placeholder={f.placeholder}
                      rows={3}
                      className="w-full px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-[13px] text-foreground placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/40"
                    />
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={String(values[f.id] ?? '')}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full h-9 px-3 rounded-md bg-white/[0.03] border border-white/[0.08] text-[13px] text-foreground placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/40"
                    />
                  )}
                  {f.help && <p className="text-[10.5px] text-neutral-600">{f.help}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Expected Output */}
          <div className="space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">Expected Output</span>
            <p className="text-[12.5px] text-neutral-300 font-medium">
              {workflow.outputType === 'lead_table'
                ? 'Account opportunities in Workbench'
                : workflow.outputType === 'contact_table'
                ? 'Decision-maker contacts in Workbench'
                : workflow.outputType === 'draft_list'
                ? 'Outreach drafts in Awaiting You'
                : workflow.outputType === 'content_doc'
                ? 'Content draft'
                : 'Website audit report'}
            </p>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] text-[11.5px] text-emerald-200/90">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
            <span>{workflow.safety}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.05] bg-black/40">
          <div className="text-[11px] text-neutral-500 font-mono">{workflow.estimatedCredits}</div>
          <button
            onClick={handleRun}
            disabled={!canRun || !requiredOk || running}
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md text-[12.5px] font-medium transition-all',
              canRun && requiredOk && !running
                ? 'bg-emerald-500/90 text-black hover:bg-emerald-400 shadow-[0_0_16px_-4px_rgba(16,185,129,0.6)]'
                : 'bg-white/[0.04] text-neutral-500 cursor-not-allowed',
            )}
          >
            {running ? <>Dispatching… <ArrowRight className="w-3.5 h-3.5" /></> : <><Play className="w-3.5 h-3.5" /> Run workflow</>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
