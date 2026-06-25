import { useState } from 'react';
import { Play, Settings2, X, ShieldCheck, AlertCircle, Sparkles, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dispatchChatAction } from '@/lib/chatActions';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';

interface WorkflowConfirmationPayload {
  workflow_id: string;
  workflow_name: string;
  goal: string;
  agent_team: string[];
  inputs: {
    count?: number;
    source?: string;
    industry?: string;
    location?: string;
    persona?: string;
    strictness?: 'strict' | 'flexible';
    output_type?: string;
    url?: string;
    [key: string]: any;
  };
  output: string;
  safety: string;
  estimated_credits: number;
  blocked?: boolean;
  blocked_reason?: string | null;
  setup_needed?: string | null;
}

interface Props {
  payload: WorkflowConfirmationPayload;
  conversationId: string | null;
}

export default function WorkflowConfirmationCard({ payload, conversationId }: Props) {
  const tools = useToolAvailability();
  const [isEditing, setIsEditing] = useState(false);
  const [inputs, setInputs] = useState({ ...payload.inputs });
  const [cancelled, setCancelled] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Check client-side capabilities as a backup / sync to live tools state
  const isFirecrawlMissing = (payload.workflow_id === 'enrich_companies' || payload.workflow_id === 'website_audit') && (!tools.firecrawl?.configured || !tools.firecrawl?.enabled);
  const isApifyPeopleMissing = payload.workflow_id === 'find_decision_makers' && (!tools.apify_people?.configured || !tools.apify_people?.enabled);

  const blocked = payload.blocked || isFirecrawlMissing || isApifyPeopleMissing;
  const setupNeeded = payload.setup_needed || (isFirecrawlMissing ? 'Firecrawl' : isApifyPeopleMissing ? 'Apify' : null);
  const blockedReason = payload.blocked_reason || (
    isFirecrawlMissing ? 'This workflow requires website scraping before Hawk can run it.'
    : isApifyPeopleMissing ? 'This workflow requires individual people/profile sourcing, which is not configured.'
    : null
  );

  const handleStart = () => {
    if (blocked) return;

    // Build the query command to run
    let cmd = `Run workflow: ${payload.workflow_name}. `;
    if (inputs.count) cmd += `Count: ${inputs.count}. `;
    if (inputs.location) cmd += `Location: ${inputs.location}. `;
    if (inputs.industry) cmd += `Industry: ${inputs.industry}. `;
    if (inputs.persona) cmd += `Persona: ${inputs.persona}. `;
    if (inputs.url) cmd += `URL: ${inputs.url}. `;
    if (inputs.source) cmd += `Source: ${inputs.source}. `;

    dispatchChatAction({
      text: cmd,
      conversation_id: conversationId,
      action_source: 'lead_intake_card', // reuse source category to trigger planner
      metadata: {
        confirmed: true,
        workflow_id: payload.workflow_id,
        workflow_inputs: inputs,
      },
    });
    setSubmitted(true);
  };

  const handleSave = () => {
    setIsEditing(false);
  };

  if (cancelled) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 text-[13px] text-[#7D8590] italic">
        Workflow cancelled.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5 text-[13px] text-emerald-300 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-400" />
        Starting workflow: {payload.workflow_name}...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-[#0d1117] p-5 max-w-[580px] shadow-xl">
      <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#7D8590] mb-1">
        Pilot understood this as:
      </div>
      <h4 className="text-[18px] font-bold text-white tracking-tight flex items-center gap-1.5">
        {payload.workflow_name}
      </h4>

      <div className="mt-4 space-y-4">
        {/* Goal */}
        <div>
          <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider">Goal:</div>
          <p className="text-[13.5px] text-[#C9D1D9] mt-0.5 leading-relaxed">{payload.goal}</p>
        </div>

        {/* Agent team */}
        <div>
          <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider mb-1.5">Agent team:</div>
          <div className="flex items-center gap-1.5 text-[13px] text-[#C9D1D9] font-semibold bg-white/[0.02] border border-white/[0.06] rounded-lg p-2.5">
            {payload.agent_team.map((slug, idx) => {
              const name = AGENT_BY_ID[slug]?.name || slug;
              return (
                <div key={slug} className="flex items-center gap-1.5">
                  <span className="text-[#C9D1D9]">{name}</span>
                  {idx < payload.agent_team.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-neutral-600 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Gated Capability Alert */}
        {blocked && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 flex items-start gap-2.5 text-[12.5px] text-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Setup needed: {setupNeeded}</div>
              <div className="text-[11.5px] text-amber-300/80 mt-0.5 leading-normal">{blockedReason}</div>
            </div>
          </div>
        )}

        {/* Inputs */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider">Inputs:</div>
            {!isEditing && !blocked && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-[11.5px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
              >
                <Settings2 className="h-3 w-3" /> Edit inputs
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="bg-white/[0.01] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
              {Object.keys(inputs).map((key) => {
                if (key === 'strictness') {
                  return (
                    <div key={key} className="space-y-1">
                      <Label className="text-[11.5px] text-neutral-400 capitalize">{key}</Label>
                      <Select
                        value={String(inputs[key] ?? 'flexible')}
                        onValueChange={(val) => setInputs((p) => ({ ...p, [key]: val }))}
                      >
                        <SelectTrigger className="h-8 text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="strict" className="text-[12.5px]">Strict</SelectItem>
                          <SelectItem value="flexible" className="text-[12.5px]">Flexible</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                const label = key.replace(/_/g, ' ');
                const val = inputs[key];
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-[11.5px] text-neutral-400 capitalize">{label}</Label>
                    <Input
                      type={typeof val === 'number' ? 'number' : 'text'}
                      value={val ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setInputs((p) => ({
                          ...p,
                          [key]: typeof val === 'number' ? (parseInt(v, 10) || 0) : v,
                        }));
                      }}
                      className="h-8 text-[12.5px]"
                    />
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 pt-2">
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-7 text-[12px]">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} className="h-7 bg-emerald-500 text-black font-semibold text-[12px] hover:bg-emerald-400">
                  Apply changes
                </Button>
              </div>
            </div>
          ) : (
            <ul className="text-[13px] text-[#C9D1D9] bg-white/[0.01] border border-white/[0.04] rounded-lg p-3 space-y-1.5 font-medium">
              {Object.entries(inputs).map(([k, v]) => {
                if (v == null || v === '') return null;
                const label = k.replace(/_/g, ' ');
                return (
                  <li key={k} className="flex items-baseline gap-2">
                    <span className="text-[#7D8590] capitalize font-normal">{label}:</span>
                    <span>{String(v)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Output */}
        <div>
          <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider">Expected Output:</div>
          <p className="text-[13px] text-[#C9D1D9] mt-0.5">{payload.output}</p>
        </div>

        {/* Bottom Metadata & Actions */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between flex-wrap gap-2 text-[12px]">
          <div className="text-[#7D8590]">
            Estimated: <span className="font-mono text-emerald-300">~{payload.estimated_credits} credits</span>
          </div>
          <div className="flex items-center gap-1 text-[#7D8590]">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
            {payload.safety}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            size="sm"
            onClick={handleStart}
            disabled={blocked}
            className={`font-bold flex items-center gap-1.5 h-9 px-4 rounded-lg transition-colors ${
              blocked
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/[0.04]'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_16px_rgba(16,185,129,0.2)]'
            }`}
          >
            <Play className="h-3.5 w-3.5" /> Start workflow
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCancelled(true)}
            className="h-9 text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
