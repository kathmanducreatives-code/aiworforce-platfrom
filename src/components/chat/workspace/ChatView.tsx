import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowRight, Copy, Check } from 'lucide-react';
import { useChatConversation } from '@/hooks/useChatConversation';
import { useChatWorkspace, type LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import { resolveAgent, resolveAgentFromMetadata } from '@/lib/agentResolver';
import { cn } from '@/lib/utils';
import ExecutionPlanCard from './plan/ExecutionPlanCard';
import ClarificationCard from './bubbles/ClarificationCard';
import LeadIntakeCard, { type LeadIntakeFormPayload } from './bubbles/LeadIntakeCard';
import LeadSourceCard, { type LeadSourceSelectorPayload } from './bubbles/LeadSourceCard';
import PostLeadActionsCard, { type PostLeadActionsCardPayload } from './bubbles/PostLeadActionsCard';
import WorkflowConfirmationCard from './bubbles/WorkflowConfirmationCard';
import ResumeRunCard from './bubbles/ResumeRunCard';
import BetaAccessCard from './bubbles/BetaAccessCard';
import InterpretationPill from './bubbles/InterpretationPill';
import SafetyChip from './bubbles/SafetyChip';
import AgentAvatar from './agents/AgentAvatar';
import AgentTypingIndicator from './AgentTypingIndicator';
import EmptyState from './EmptyState';
import { dispatchChatAction } from '@/lib/chatActions';
import { startedCardIds } from '@/lib/chat/startedCards';

/** The person's own message: a quiet raised surface, warm white text. */
const USER_BUBBLE =
  'max-w-[min(720px,70%)] rounded-2xl bg-white/[0.06] border border-white/[0.08] px-4 py-2.5 text-[15px] leading-[1.55] text-[#F2EFEA] whitespace-pre-wrap break-words';
/** An agent's message: a subtle dark surface with a hairline border. Identity lives in the header, not the bubble. */
const AGENT_BUBBLE =
  'chat-message-bubble rounded-2xl border border-white/[0.06] bg-white/[0.025] text-[15px] leading-[1.6] whitespace-pre-wrap';

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
  const { messages, state } = useChatConversation(conversationId);
  const { openWorkbench } = useChatWorkspace();
  const openedPanelsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  

  // Workflow cards a Start has already approved — from the messages, so a
  // remounted card cannot offer Start again.
  const startedCards = startedCardIds(messages);

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
          // THE FULL OWNERSHIP CHAIN: conversation → task → plan.
          //
          // This used to omit `taskId`, so `useWorkbenchData` could never find
          // the task row and the panel could not read the incremental progress
          // the engine had written to `tasks.result.workbench_progress`. Task
          // 41342269 had recorded 25 discovered companies and the Workbench
          // showed "Accounts found: 0".
          taskId: (meta?.task_id as string | undefined) ?? null,
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

  // Track the prior agent so we can render a Slack-style handoff divider
  // between two consecutive agent messages from different team members.
  let prevAgentSlug: string | null = null;

  // A NEW CHAT OPENS ON THE WELCOME SCREEN. "New chat" creates a conversation
  // and opens it, so the workspace's own empty view never shows; a loaded
  // conversation with nothing in it rendered a blank pane. Only once loading
  // has settled on "empty" — an existing conversation never flashes it — and
  // the first message (sent, pending or awaited) replaces it.
  if (state === 'empty' && messages.length === 0 && !showPending && !awaitingReply) {
    return <EmptyState />;
  }

  return (

    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
      {messages.map((m) => {
        if (m.role === 'user') {
          prevAgentSlug = null;
          return (
            <div key={m.id} className="flex justify-end">
              <div className={USER_BUBBLE}>
                {m.content}
              </div>
            </div>
          );
        }
        const meta0 = (m.metadata ?? null) as Record<string, any> | null;
        const msgProfile = resolveAgentFromMetadata(meta0, m.agent_slug ?? agentSlug, m.content);
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
        const showPennSafety = slug === 'penn';

        const handoffFrom = prevAgentSlug && prevAgentSlug !== slug ? prevAgentSlug : null;
        prevAgentSlug = slug;

        return (
          <Fragment key={m.id}>
            {handoffFrom && <HandoffDivider fromSlug={handoffFrom} toSlug={slug} />}
            <div className="flex items-start gap-3">
              <AgentAvatar slug={slug} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
                  <span className="text-[14px] font-medium text-[#F2EFEA]">{name}</span>
                  <span className="text-[12.5px] text-[#8B8F96]">· {role}</span>
                </div>

                {structured ? (
                  <div
                    className={cn(AGENT_BUBBLE, 'relative p-4 pr-9 text-[#ECE9E4]')}
                    style={{ maxWidth: 'min(720px, 86%)' }}
                  >
                    <div className="absolute top-2.5 right-2.5"><CopyButton text={m.content} /></div>
                    {m.content}
                  </div>
                ) : (
                  <div
                    className={cn(
                      AGENT_BUBBLE, 'px-4 py-3',
                      m.is_error ? 'text-[#9aa4af]' : 'text-[#ECE9E4]',
                    )}
                    style={{ maxWidth: 'min(720px, 86%)' }}
                  >
                    {m.content}
                  </div>
                )}
                {showPennSafety && (
                  <div className="mt-1.5"><SafetyChip /></div>
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
                  <div className="mt-2.5 flex flex-wrap gap-2 max-w-[640px]">
                    {uiActions.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => dispatchChatAction({ text: a.message, conversation_id: m.conversation_id, action_source: 'ui_actions_button' })}
                        className="inline-flex items-center rounded-full border border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/[0.16] px-3.5 py-1.5 text-[13.5px] font-medium text-[#ECE9E4] transition-colors"
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
                {meta && meta.kind === 'run_checkpoint' && meta.task_id && meta.plan_id
                  && meta.continuation_owner !== 'v2_queue' && (
                  <ResumeRunCard
                    taskId={String(meta.task_id)}
                    planId={String(meta.plan_id)}
                    conversationId={m.conversation_id}
                    summary={typeof meta.checkpoint_summary === 'string'
                      ? meta.checkpoint_summary : null}
                  />
                )}
                {/* Pilot's "no credits yet" reply to a paid Start (private beta): file the
                    request here, then show where it stands. */}
                {meta && meta.credits_required === true && <BetaAccessCard />}
                {meta && meta.type === 'workflow_confirmation' && meta.workflow_confirmation && (
                  <div className="mt-2">
                    <WorkflowConfirmationCard
                      payload={meta.workflow_confirmation as any}
                      conversationId={m.conversation_id}
                      messageId={m.id}
                      alreadyStarted={startedCards.has(m.id)}
                    />
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}


      {showPending && (
        <div className="flex justify-end">
          <div className={cn(USER_BUBBLE, 'opacity-70')}>
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

function HandoffDivider({ fromSlug, toSlug }: { fromSlug: string; toSlug: string }) {
  const from = resolveAgent(fromSlug);
  const to = resolveAgent(toSlug);
  return (
    <div className="flex items-center gap-2 pl-10 py-0.5 select-none text-[12px] text-[#8B8F96]" aria-label={`Handoff from ${from.name} to ${to.name}`}>
      <AgentAvatar slug={from.id} size="xs" ring={false} />
      <span>{from.name}</span>
      <ArrowRight className="h-3 w-3 text-[#5C6067]" aria-hidden />
      <AgentAvatar slug={to.id} size="xs" ring={false} />
      <span className="text-[#ECE9E4]">{to.name}</span>
    </div>
  );
}
