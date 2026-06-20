import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useChatConversation } from '@/hooks/useChatConversation';
import { useChatWorkspace, type LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import { resolveAgent, resolveAgentFromMetadata } from '@/lib/agentResolver';
import { cn } from '@/lib/utils';
import ExecutionPlanCard from './plan/ExecutionPlanCard';
import ClarificationCard from './bubbles/ClarificationCard';
import LeadIntakeCard, { type LeadIntakeFormPayload } from './bubbles/LeadIntakeCard';
import LeadSourceCard, { type LeadSourceSelectorPayload } from './bubbles/LeadSourceCard';
import PostLeadActionsCard, { type PostLeadActionsCardPayload } from './bubbles/PostLeadActionsCard';
import InterpretationPill from './bubbles/InterpretationPill';
import AgentAvatar from './agents/AgentAvatar';
import AgentTypingIndicator from './AgentTypingIndicator';
import { dispatchChatAction } from '@/lib/chatActions';


function isStructured(text: string): boolean {
  if (!text) return false;
  const lines = text.split('\n');
  if (lines.length >= 4 && (text.match(/\n\s*\n/) || text.match(/^\s*[-*]\s/m) || text.match(/^\s*\d+\.\s/m))) {
    return true;
  }
  return false;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[#484F58] hover:text-[#7D8590] transition-colors"
      aria-label="Copy"
      type="button"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}


interface Props {
  conversationId: string;
  agentSlug: string;
  pendingUserText?: string | null;
  awaitingReply?: boolean;
}

export default function ChatView({ conversationId, agentSlug, pendingUserText, awaitingReply }: Props) {
  const { messages } = useChatConversation(conversationId);
  const { openWorkbench } = useChatWorkspace();
  const openedPanelsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const profile = resolveAgent(agentSlug);

  // Hide pending user text once it appears in real messages
  const showPending = pendingUserText && !messages.some(
    (m) => m.role === 'user' && m.content === pendingUserText,
  );

  // Auto-open the Workbench (Lead Results) when a message arrives with a
  // ui_panel hint. Guarded per message id so we don't reopen after the user
  // closes the panel.
  useEffect(() => {
    for (const m of messages) {
      const meta = (m.metadata ?? null) as Record<string, any> | null;
      const panel = meta?.ui_panel as LeadResultsPanelMeta | undefined;
      if (panel && panel.kind === 'lead_results' && !openedPanelsRef.current.has(m.id)) {
        openedPanelsRef.current.add(m.id);
        openWorkbench({
          planId: panel.plan_id,
          panel,
          conversationId: m.conversation_id ?? conversationId,
        });
      }
    }
  }, [messages, openWorkbench, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, awaitingReply, showPending]);

  const lastIsUser = (messages[messages.length - 1]?.role === 'user') || !!showPending;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[min(620px,78%)] rounded-2xl bg-emerald-500/[0.10] border border-emerald-500/20 backdrop-blur-md px-3.5 py-2 text-[13.5px] leading-relaxed text-[#E6F4EC] whitespace-pre-wrap break-words shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
                {m.content}
              </div>
            </div>

          );
        }
        const meta0 = (m.metadata ?? null) as Record<string, any> | null;
        const msgProfile = resolveAgentFromMetadata(meta0, m.agent_slug ?? agentSlug);
        const slug = msgProfile.id;
        const name = msgProfile.name;
        const role = msgProfile.role;
        const accent = msgProfile.accentHex ?? '#7D8590';

        const structured = isStructured(m.content);
        const meta = meta0;
        const planMeta = meta && meta.type === 'execution_plan' && typeof meta.plan_id === 'string'
          ? meta as { plan_id: string; plan_title?: string; task_count?: number; agents?: string[]; connector_limitations?: string[] }
          : null;
        const toolInput = (meta?.tool_input ?? null) as Record<string, any> | null;
        const uiFormKind = meta && meta.ui_form ? (meta.ui_form as any).kind : null;
        const leadForm = uiFormKind === 'lead_intake' ? (meta!.ui_form as LeadIntakeFormPayload) : null;
        const leadSelector = uiFormKind === 'lead_source_selector' ? (meta!.ui_form as LeadSourceSelectorPayload) : null;
        const postLeadCard = meta && meta.ui_card && (meta.ui_card as any).kind === 'post_lead_actions'
          ? (meta.ui_card as PostLeadActionsCardPayload)
          : null;
        const uiActions = Array.isArray(meta?.ui_actions)
          ? (meta!.ui_actions as Array<{ label: string; message: string }>)
          : null;
        const isClarification =
          !!meta &&
          (meta.clarification === true || meta.needs_clarification === true || !!meta.pending_clarification) &&
          (toolInput?.people_action || toolInput?.companies_action || toolInput?.agency_action ||
            meta.people_action || meta.companies_action || meta.agency_action);
        const peopleAction = toolInput?.people_action ?? meta?.people_action ?? null;
        const companiesAction = toolInput?.companies_action ?? meta?.companies_action ?? null;
        const agencyAction = toolInput?.agency_action ?? meta?.agency_action ?? null;
        return (
          <div key={m.id} className="flex items-start gap-3">
            <AgentAvatar slug={slug} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-[12.5px] font-semibold text-[#E6EDF3]">{name}</span>
                <span className="text-[11px]" style={{ color: accent }}>· {role}</span>
              </div>

              {structured ? (
                <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl p-4 text-[13.5px] leading-relaxed text-[#F0F6FC] whitespace-pre-wrap shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
                  <div className="absolute top-2 right-2"><CopyButton text={m.content} /></div>
                  {m.content}
                </div>
              ) : (
                <div className={cn('text-[13.5px] leading-relaxed whitespace-pre-wrap', m.is_error ? 'text-[#7D8590]' : 'text-[#F0F6FC]')}>
                  {m.content}
                </div>
              )}
              {toolInput && (toolInput.business_goal || toolInput.intent || toolInput.selected_actor_key || toolInput.execution_mode) && !isClarification && !planMeta && (
                <InterpretationPill
                  businessGoal={toolInput.business_goal ?? null}
                  intent={toolInput.intent ?? null}
                  selectedActorKey={toolInput.selected_actor_key ?? null}
                  executionMode={toolInput.execution_mode ?? null}
                />
              )}
              {leadSelector && (
                <div className="mt-2">
                  <LeadSourceCard payload={leadSelector} conversationId={m.conversation_id} />
                </div>
              )}
              {postLeadCard && (
                <div className="mt-2">
                  <PostLeadActionsCard payload={postLeadCard} conversationId={m.conversation_id} />
                </div>
              )}
              {leadForm && (
                <div className="mt-2">
                  <LeadIntakeCard payload={leadForm} conversationId={m.conversation_id} />
                </div>
              )}
              {uiActions && uiActions.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5 max-w-[460px]">
                  {uiActions.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => dispatchChatAction({ text: a.message, conversation_id: m.conversation_id, action_source: 'ui_actions_button' })}
                      className="text-left rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.1] hover:border-emerald-500/40 px-3 py-2 text-[13px] text-[#C9D1D9] transition-colors"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {isClarification && !leadForm && !leadSelector && (
                <div className="mt-2">
                  <ClarificationCard
                    question={m.content}
                    peopleAction={peopleAction}
                    companiesAction={companiesAction}
                    agencyAction={agencyAction}
                    conversationId={m.conversation_id}
                  />
                </div>
              )}
              {planMeta && (
                <ExecutionPlanCard
                  planId={planMeta.plan_id}
                  meta={{
                    plan_title: planMeta.plan_title,
                    task_count: planMeta.task_count,
                    agents: planMeta.agents,
                    connector_limitations: planMeta.connector_limitations,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}

      {showPending && (
        <div className="flex justify-end">
          <div className="max-w-[min(680px,85%)] rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/15 px-3.5 py-2 text-[14px] leading-relaxed text-[#F0F6FC] whitespace-pre-wrap break-words opacity-80">
            {pendingUserText}
          </div>
        </div>
      )}


      {awaitingReply && lastIsUser && (
        <AgentTypingIndicator slug={agentSlug} />
      )}
    </div>
  );
}
