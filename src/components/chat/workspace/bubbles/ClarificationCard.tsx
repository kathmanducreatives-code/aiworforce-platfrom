import { Users, Building2, Briefcase, HelpCircle, ArrowRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ActionMeta {
  tool_name?: string | null;
  selected_actor_key?: string | null;
  location?: string | null;
  max_results?: number | null;
  role_keywords?: string[] | null;
  query?: string | null;
}

import { dispatchChatAction } from '@/lib/chatActions';

interface Props {
  question: string;
  peopleAction?: ActionMeta | null;
  companiesAction?: ActionMeta | null;
  agencyAction?: ActionMeta | null;
  conversationId: string | null;
}

function sendReply(text: string, conversationId: string | null) {
  dispatchChatAction({ text, conversation_id: conversationId, action_source: 'clarification_card' });
}

function preview(a: ActionMeta | null | undefined): string {
  if (!a) return '';
  const parts: string[] = [];
  if (a.selected_actor_key) parts.push(a.selected_actor_key);
  else if (a.tool_name) parts.push(a.tool_name);
  if (a.location) parts.push(a.location);
  if (typeof a.max_results === 'number') parts.push(`${a.max_results} results`);
  return parts.join(' · ');
}

function Option({
  icon: Icon,
  label,
  sub,
  reply,
  disabled,
  disabledHint,
  conversationId,
}: {
  icon: any;
  label: string;
  sub: string;
  reply: string;
  disabled?: boolean;
  disabledHint?: string;
  conversationId: string | null;
}) {
  const btn = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && sendReply(reply, conversationId)}
      className={`group w-full text-left rounded-lg border px-3 py-2.5 transition-colors flex items-center gap-3 ${
        disabled
          ? 'border-white/[0.04] bg-white/[0.01] text-[#484F58] cursor-not-allowed'
          : 'border-white/[0.08] bg-white/[0.02] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30'
      }`}
    >
      <span
        className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
          disabled ? 'bg-white/[0.03] text-[#484F58]' : 'bg-emerald-500/10 text-emerald-300'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${disabled ? 'text-[#7D8590]' : 'text-[#F0F6FC]'}`}>{label}</div>
        {sub && <div className="text-[11px] text-[#7D8590] truncate mt-0.5">{sub}</div>}
      </div>
      {!disabled && (
        <ArrowRight className="h-3.5 w-3.5 text-[#484F58] group-hover:text-emerald-300 transition-colors shrink-0" />
      )}
    </button>
  );
  if (disabled && disabledHint) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="top">{disabledHint}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}

export default function ClarificationCard({
  question,
  peopleAction,
  companiesAction,
  agencyAction,
  conversationId,
}: Props) {
  const any = peopleAction || companiesAction || agencyAction;
  if (!any) return null;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-6 w-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <HelpCircle className="h-3.5 w-3.5 text-emerald-300" />
        </span>
        <div className="text-[10px] uppercase tracking-widest text-emerald-300/90 font-semibold">
          Pilot needs one decision
        </div>
      </div>
      {question && (
        <div className="text-[13px] text-[#C9D1D9] leading-relaxed mb-3">{question}</div>
      )}
      <div className="space-y-2">
        {peopleAction && (
          <Option
            icon={Users}
            label="Individual profiles"
            sub={preview(peopleAction)}
            reply="individual profiles"
          />
        )}
        {companiesAction && (
          <Option
            icon={Building2}
            label="Companies hiring"
            sub={preview(companiesAction)}
            reply="companies hiring"
          />
        )}
        {agencyAction && (
          <Option
            icon={Briefcase}
            label="Agencies / dev partners"
            sub={agencyAction.tool_name ? preview(agencyAction) : 'No dedicated sourcing yet'}
            reply="agencies"
            disabled={!agencyAction.tool_name}
            disabledHint="Dedicated agency sourcing isn't configured — Pilot will offer a workaround."
          />
        )}
      </div>
    </div>
  );
}
