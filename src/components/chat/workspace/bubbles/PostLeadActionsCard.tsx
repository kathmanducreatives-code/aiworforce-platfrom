import { useState } from 'react';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import { dispatchChatAction } from '@/lib/chatActions';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import AgentAvatar from '../agents/AgentAvatar';
import { toast } from 'sonner';

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
  plan_id?: string;
  panel?: any;
}

/**
 * Compact pill row replacement for the legacy stacked post-result card.
 * Chat stays lightweight; the full action surface lives in the Workbench.
 */
export default function PostLeadActionsCard({ payload, conversationId }: { payload: PostLeadActionsCardPayload; conversationId: string | null }) {
  const [done, setDone] = useState<string | null>(null);
  const { openWorkbench, selectedOutput } = useChatWorkspace();

  const run = (o: ActionOption) => {
    dispatchChatAction({
      text: o.command,
      conversation_id: conversationId,
      action_source: 'post_lead_actions_card',
      metadata: { post_lead_action: o.action, lead_candidate_ids: payload.lead_candidate_ids },
    });
    setDone(`${o.label} queued${o.credits > 0 ? ` · ~${o.credits}c` : ''}. Nothing will be sent without your approval.`);
  };

  const openResults = () => {
    if (payload.plan_id && payload.panel) {
      openWorkbench({
        planId: payload.plan_id,
        panel: payload.panel,
        conversationId: conversationId ?? null,
      });
      toast.success('Result opened in Workbench');
    } else if (selectedOutput?.planId) {
      openWorkbench(selectedOutput);
      toast.success('Result opened in Workbench');
    }
  };

  // Preferred order; only render what backend offered.
  const order: PostLeadAction[] = ['rank', 'enrich', 'draft_outreach', 'enrich_and_draft', 'save_only', 'export'];
  const sorted = [...payload.options].sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action));

  const SHORT_LABEL: Record<PostLeadAction, string> = {
    rank: 'Rank by fit',
    enrich: 'Enrich companies',
    draft_outreach: 'Draft outreach',
    enrich_and_draft: 'Enrich + draft',
    save_only: 'Save only',
    export: 'Export CSV',
  };

  if (done) {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-emerald-300/90">
        <ShieldCheck className="h-3 w-3" /> {done}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 mr-1">
        <AgentAvatar slug="pilot" size="xs" />
        <span className="text-[12px] text-[#9aa4af]">Pilot</span>
      </span>
      {(payload.plan_id || selectedOutput?.planId) && (
        <button
          type="button"
          onClick={openResults}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium bg-emerald-500/[0.12] border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/[0.18] hover:border-emerald-500/45 transition-colors"
        >
          <ExternalLink className="h-3 w-3" /> View results
        </button>
      )}
      {sorted.map((o) => (
        <button
          key={o.action}
          type="button"
          onClick={() => run(o)}
          title={o.description}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] bg-white/[0.04] border border-white/[0.08] text-[#C9D1D9] hover:bg-emerald-500/[0.08] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors"
        >
          <span>{SHORT_LABEL[o.action] ?? o.label}</span>
          {o.credits > 0 && (
            <span className="text-[10.5px] text-emerald-300/80 font-mono">~{o.credits}c</span>
          )}
        </button>
      ))}
      <span className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] ml-1">
        <ShieldCheck className="h-3 w-3 text-emerald-400/60" /> draft-only
      </span>
    </div>
  );
}
