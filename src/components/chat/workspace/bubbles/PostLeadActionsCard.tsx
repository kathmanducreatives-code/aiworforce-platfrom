import { useState } from 'react';
import { Save, Star, Globe, PenLine, Sparkles, Archive, Coins, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PostLeadAction = 'save_only' | 'rank' | 'enrich' | 'draft_outreach' | 'enrich_and_draft' | 'export';

interface BreakdownLine { label: string; unit_cost: number; quantity: number; total: number; }
interface ActionOption {
  action: PostLeadAction; label: string; description: string; runs: string;
  credits: number; enrichable_count?: number; breakdown: BreakdownLine[];
  note?: string; safety_note?: string; requires_confirm: boolean; command: string;
}
export interface PostLeadActionsCardPayload {
  kind: 'post_lead_actions';
  title: string; subtitle: string;
  lead_count: number; enrichable_count: number; lead_candidate_ids: string[];
  options: ActionOption[];
}

const ICONS: Record<PostLeadAction, any> = {
  save_only: Save, rank: Star, enrich: Globe, draft_outreach: PenLine, enrich_and_draft: Sparkles, export: Archive,
};

function send(text: string, conversationId?: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: { text, conversation_id: conversationId } }));
}

export default function PostLeadActionsCard({ payload, conversationId }: { payload: PostLeadActionsCardPayload; conversationId?: string }) {
  const [confirming, setConfirming] = useState<PostLeadAction | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-[13px] text-[#C9D1D9]">
        {done}
      </div>
    );
  }

  const run = (o: ActionOption) => { send(o.command, conversationId); setDone(`Running: ${o.label}${o.credits > 0 ? ` (~${o.credits} credits)` : ''}. Nothing will be sent without your approval.`); };

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4 max-w-[600px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-6 w-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <Coins className="h-3.5 w-3.5 text-emerald-300" />
        </span>
        <div className="text-[13px] font-semibold text-[#F0F6FC]">Leads found. What should Agentory do next?</div>
      </div>
      <p className="text-[12px] text-[#7D8590] leading-relaxed mb-1">{payload.subtitle}</p>
      <p className="text-[10px] text-[#7D8590]/80 mb-3">Costs are estimated Agentory credits, not vendor charges.</p>

      <div className="grid grid-cols-1 gap-2">
        {payload.options.map((o) => {
          const Icon = ICONS[o.action] ?? Star;
          const isConfirming = confirming === o.action;
          return (
            <div key={o.action} className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-start gap-3">
                <span className="h-7 w-7 rounded-md bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-medium text-[#F0F6FC]">{o.label}</div>
                    <span className={`text-[11px] font-semibold shrink-0 ${o.credits === 0 ? 'text-[#7D8590]' : 'text-emerald-300'}`}>
                      {o.credits === 0 ? '0 credits' : `~${o.credits} credits`}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#7D8590] mt-0.5 leading-snug">{o.description}</div>
                  <div className="text-[10px] text-[#7D8590]/80 mt-1">Runs: {o.runs}</div>
                  {o.note && <div className="text-[10px] text-amber-300/70 mt-1">{o.note}</div>}
                  {o.safety_note && (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-400/70 mt-1">
                      <ShieldCheck className="h-2.5 w-2.5" /> {o.safety_note}
                    </div>
                  )}

                  {!isConfirming ? (
                    <button
                      onClick={() => (o.requires_confirm ? setConfirming(o.action) : run(o))}
                      className="mt-2 text-[12px] text-emerald-300 hover:text-emerald-200 font-medium"
                    >
                      {o.requires_confirm ? `Choose · ~${o.credits} credits` : 'Choose'} →
                    </button>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[12px] text-[#C9D1D9]">Run {o.label.toLowerCase()} for ~{o.credits} credits?</span>
                      <Button size="sm" onClick={() => run(o)} className="h-7 bg-emerald-500/90 hover:bg-emerald-500 text-[#03100a] font-semibold text-[12px]">Confirm and run</Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirming(null)} className="h-7 text-[12px]">Cancel</Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[#7D8590]">
        <ShieldCheck className="h-3 w-3 text-emerald-400/70" /> Drafts require your approval — nothing is sent automatically.
      </div>
    </div>
  );
}
