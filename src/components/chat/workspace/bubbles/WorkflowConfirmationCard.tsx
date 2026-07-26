import { useState } from 'react';
import { Play, Settings2, ShieldCheck, AlertCircle, Sparkles, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dispatchChatAction } from '@/lib/chatActions';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import {
  isQualifiedLeadPayload, buildWorkflowPreview, buildStartWorkflowPayload,
  type QualifiedLeadContract,
} from '@/lib/qualifiedLead/contract';
import { executionStages, COMPOUND_STAGE_NOTE } from '@/lib/qualifiedLead/planCopy';

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
  // Company-Brain transparency: the target company profile vs. what's excluded.
  target_company?: string[];
  excluded_company?: string[];
  blocked?: boolean;
  blocked_reason?: string | null;
  setup_needed?: string | null;
  // Lead Intelligence Engine: the structured intent (workflow_type, source_type,
  // role family + aliases/excludes) the backend extracted. Threaded back on Start
  // so the confirmed request is NOT re-classified (which misrouted hiring→people).
  lead_intent?: {
    workflow_type?: string;
    source_type?: string;
    role_family?: string | null;
    role_keywords?: string[];
    exclude_role_keywords?: string[];
    [k: string]: unknown;
  };
  // QUALIFIED-LEAD ROUTE. When present, the preview renders from this structured
  // contract — never from `workflow_name` or a reconstructed command string.
  workflow_kind?: string;
  execution_mode?: string;
  execution_mode_label?: string;
  original_instruction?: string;
  qualified_lead_contract?: QualifiedLeadContract | null;
}

interface Props {
  payload: WorkflowConfirmationPayload;
  conversationId: string | null;
}

// Compact, premium "workflow preview" card. It is NOT a confirmation modal — the
// natural Pilot reply sits above it (message content) and this card is a smooth
// handoff: title, agent team, input chips, output, calm safety note, credits,
// and a primary Start / secondary Edit / subtle Cancel.
export default function WorkflowConfirmationCard({ payload, conversationId }: Props) {
  const tools = useToolAvailability();
  const [isEditing, setIsEditing] = useState(false);
  const [inputs, setInputs] = useState({ ...payload.inputs });
  const [cancelled, setCancelled] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Client-side capability backup / sync to live tools state.
  const isFirecrawlMissing = (payload.workflow_id === 'enrich_companies' || payload.workflow_id === 'website_audit') && (!tools.firecrawl?.configured || !tools.firecrawl?.enabled);
  const isApifyPeopleMissing = payload.workflow_id === 'find_decision_makers' && (!tools.apify_people?.configured || !tools.apify_people?.enabled);

  const blocked = payload.blocked || isFirecrawlMissing || isApifyPeopleMissing;
  const setupNeeded = payload.setup_needed || (isFirecrawlMissing ? 'Firecrawl' : isApifyPeopleMissing ? 'People/company employee provider' : null);
  const blockedReason = payload.blocked_reason || (
    isFirecrawlMissing ? 'This workflow needs website scraping before Hawk can run it.'
    : isApifyPeopleMissing ? 'This workflow needs individual people/profile sourcing, which isn\'t set up yet.'
    : null
  );

  // Compact agent-team row: "Scout → Aria" (Pilot is implied, so it's dropped).
  const teamNames = payload.agent_team
    .filter((slug) => slug && slug !== 'pilot')
    .map((slug) => AGENT_BY_ID[slug]?.name || (slug[0].toUpperCase() + slug.slice(1)));

  // Input chips: short, skip empty/null, cap at 5 so the card stays compact.
  const chips = Object.entries(inputs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => (k === 'count' ? `${v} ${Number(v) === 1 ? 'result' : 'results'}` : String(v)))
    .slice(0, 5);

  // The qualified-lead route, decided by Pilot from the user's own words.
  const qualifiedLead = isQualifiedLeadPayload(payload);
  const preview = qualifiedLead ? buildWorkflowPreview(payload.qualified_lead_contract) : null;
  const stages = qualifiedLead ? executionStages('qualified_lead_sourcing') : [];

  const handleStart = () => {
    if (blocked) return;

    // START SENDS THE ORIGINAL REQUEST.
    //
    // This used to send `Run workflow: <generated title>. Count: 5. …`, so the
    // request that actually reached orchestrate was a reconstruction of a title
    // that had already lost the quota, the roles and the discipline. The
    // structured contract now travels in metadata alongside the real sentence.
    const start = buildStartWorkflowPayload(payload, inputs);

    dispatchChatAction({
      text: start.text,
      conversation_id: conversationId,
      action_source: 'lead_intake_card', // reuse source category to trigger planner
      metadata: {
        ...start.metadata,
        // Legacy actor hint for the account path; the qualified-lead path sets
        // its own inside buildStartWorkflowPayload.
        selected_actor_key: (start.metadata.selected_actor_key as string | undefined)
          ?? (payload.lead_intent?.workflow_type === 'company_hiring_sourcing' ? 'apify_jobs' : undefined),
      },
    });
    setSubmitted(true);
  };

  if (cancelled) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-[#7D8590] italic max-w-[420px]">
        No problem — I'll hold off. Just say the word when you're ready.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3.5 py-2.5 text-[13px] text-emerald-300 flex items-center gap-2 max-w-[420px]">
        <Sparkles className="h-4 w-4 text-emerald-400" />
        Starting {payload.workflow_name}…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-emerald-500/[0.04] to-[#0d1117]/60 backdrop-blur-sm p-4 max-w-[440px] shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
      {/* Title + agent team */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400/80">
            Workflow ready
          </div>
          {/* The title comes from the CONTRACT for a qualified-lead request, so
              it can never disagree with what will execute. */}
          <h4 className="text-[15.5px] font-bold text-white tracking-tight mt-0.5 truncate">
            {preview ? preview.title : payload.workflow_name}
          </h4>
          {preview && (
            <div className="mt-1 text-[13px] font-semibold text-emerald-300">
              Target: {preview.target}
            </div>
          )}
        </div>
        {teamNames.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 text-[12px] font-semibold text-[#C9D1D9] pt-1">
            {teamNames.map((name, idx) => (
              <span key={name} className="flex items-center gap-1">
                {name}
                {idx < teamNames.length - 1 && <ArrowRight className="h-3 w-3 text-neutral-600" />}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Gated capability — calm, not scary */}
      {blocked && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 flex items-start gap-2 text-[12px] text-amber-200">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Setup needed: {setupNeeded}</span>
            {blockedReason && <span className="text-amber-300/80"> — {blockedReason}</span>}
          </div>
        </div>
      )}

      {/* QUALIFIED-LEAD PREVIEW — rendered from the structured contract only.
          The generic input chips below are suppressed for this route because
          they are what rendered "5 results" for a five-LEAD request. */}
      {preview && !isEditing && (
        <div className="mt-3 space-y-2">
          <PreviewRow label="Hiring roles" items={preview.hiringRoles} tone="emerald" />
          <PreviewRow label="Decision-makers" items={preview.decisionMakers} tone="sky" />
          <PreviewRow label="Company" items={preview.companyConstraints} tone="neutral" />
          <div className="flex items-baseline gap-2 text-[12.5px]">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#7D8590] shrink-0 w-[104px]">Execution</span>
            <span className="text-[#C9D1D9]">{preview.executionMode}</span>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#7D8590]">Plan</div>
            <ol className="mt-1 space-y-0.5">
              {stages.map((s, i) => (
                <li key={s.id} className="text-[12px] text-[#C9D1D9] flex gap-1.5">
                  <span className="text-[#7D8590] tabular-nums">{i + 1}.</span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
            <div className="mt-1.5 text-[11px] text-[#7D8590] italic">{COMPOUND_STAGE_NOTE}</div>
          </div>
        </div>
      )}

      {/* Inputs */}
      <div className="mt-3">
        {preview && !isEditing ? null : isEditing ? (
          <div className="bg-white/[0.01] border border-white/[0.08] rounded-xl p-3 space-y-2.5">
            {Object.keys(inputs).map((key) => {
              if (key === 'strictness') {
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-[11px] text-neutral-400 capitalize">{key}</Label>
                    <Select
                      value={String(inputs[key] ?? 'flexible')}
                      onValueChange={(val) => setInputs((p) => ({ ...p, [key]: val }))}
                    >
                      <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="strict" className="text-[12.5px]">Strict</SelectItem>
                        <SelectItem value="flexible" className="text-[12.5px]">Flexible</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              }
              const val = inputs[key];
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px] text-neutral-400 capitalize">{key.replace(/_/g, ' ')}</Label>
                  <Input
                    type={typeof val === 'number' ? 'number' : 'text'}
                    value={val ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInputs((p) => ({ ...p, [key]: typeof val === 'number' ? (parseInt(v, 10) || 0) : v }));
                    }}
                    className="h-8 text-[12.5px]"
                  />
                </div>
              );
            })}
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => setIsEditing(false)} className="h-7 bg-emerald-500 text-black font-semibold text-[12px] hover:bg-emerald-400">
                Apply changes
              </Button>
            </div>
          </div>
        ) : (
          chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[12px] text-[#C9D1D9] capitalize"
                >
                  {c}
                </span>
              ))}
            </div>
          )
        )}
      </div>

      {/* Company-Brain target vs. excluded (transparency) */}
      {(payload.target_company?.length || payload.excluded_company?.length) ? (
        <div className="mt-3 space-y-1.5">
          {payload.target_company?.length ? (
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400/80 shrink-0 pt-0.5 w-14">Target</span>
              <div className="flex flex-wrap gap-1">
                {payload.target_company.map((t) => (
                  <span key={t} className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[11px] text-emerald-200">{t}</span>
                ))}
              </div>
            </div>
          ) : null}
          {payload.excluded_company?.length ? (
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#7D8590] shrink-0 pt-0.5 w-14">Excluded</span>
              <div className="flex flex-wrap gap-1">
                {payload.excluded_company.map((t) => (
                  <span key={t} className="inline-flex items-center rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[11px] text-[#8b949e] line-through decoration-[#8b949e]/40">{t}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Output */}
      <div className="mt-3 flex items-baseline gap-2 text-[12.5px]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#7D8590] shrink-0">Output</span>
        <span className="text-[#C9D1D9]">{preview ? preview.output : payload.output}</span>
      </div>

      {/* Safety + credits */}
      <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[12px]">
        <div className="flex items-center gap-1.5 text-emerald-300/90 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80 shrink-0" />
          <span className="truncate">{payload.safety}</span>
        </div>
        <span className="text-[#7D8590] shrink-0">~<span className="font-mono text-emerald-300">{payload.estimated_credits}</span> credits</span>
      </div>

      {/* Actions */}
      <div className="mt-3.5 flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleStart}
          disabled={blocked}
          className={`font-bold flex items-center gap-1.5 h-8 px-3.5 rounded-lg transition-colors ${
            blocked
              ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/[0.04]'
              : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_16px_rgba(16,185,129,0.18)]'
          }`}
        >
          <Play className="h-3.5 w-3.5" /> Start Workflow
        </Button>
        {!blocked && !isEditing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 text-[12.5px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            <Settings2 className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        <button
          type="button"
          onClick={() => setCancelled(true)}
          className="ml-auto text-[12px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  emerald: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200',
  sky: 'border-sky-500/20 bg-sky-500/[0.06] text-sky-200',
  neutral: 'border-white/[0.08] bg-white/[0.03] text-[#C9D1D9]',
};

/** One labelled chip row of the qualified-lead preview. */
function PreviewRow({ label, items, tone }: { label: string; items: string[]; tone: keyof typeof TONE_CLASS }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#7D8590] shrink-0 pt-0.5 w-[104px]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((t) => (
          <span key={t} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] ${TONE_CLASS[tone]}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
