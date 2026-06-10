import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { buildPlanMessages, type ChatMessage } from '@/lib/chatMessageStream';
import UserBubble from './bubbles/UserBubble';
import SystemMessage from './bubbles/SystemMessage';
import AgentBubble from './bubbles/AgentBubble';
import HandoffRow from './bubbles/HandoffRow';
import ApprovalCard from './bubbles/ApprovalCard';
import SectionDivider from './bubbles/SectionDivider';

type SectionKey = 'request' | 'workflow' | 'execution' | 'status';
const SECTION_LABELS: Record<SectionKey, string> = {
  request: 'Request',
  workflow: 'Workflow',
  execution: 'Execution',
  status: 'Status',
};

function sectionOf(m: ChatMessage, index: number): SectionKey {
  if (m.kind === 'user') return 'request';
  if (m.kind === 'system') {
    if (m.id.endsWith('-created')) return 'workflow';
    return 'status';
  }
  if (m.kind === 'approval') return 'execution';
  if (m.kind === 'handoff') return 'execution';
  return 'execution';
}

export default function ConversationView({ planId }: { planId: string }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plan, tasks, activity, approvals, loading } = usePlanDetail(planId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  const messages = useMemo(() => {
    if (!plan) return [];
    return buildPlanMessages(plan, tasks, activity, approvals, agents);
  }, [plan, tasks, activity, approvals, agents]);

  // Group consecutive messages by section
  const groups = useMemo(() => {
    const out: { section: SectionKey; items: ChatMessage[]; ts: string }[] = [];
    messages.forEach((m, i) => {
      const s = sectionOf(m, i);
      const last = out[out.length - 1];
      if (last && last.section === s) {
        last.items.push(m);
      } else {
        out.push({ section: s, items: [m], ts: m.ts });
      }
    });
    return out;
  }, [messages]);

  // Auto-scroll on new messages
  const lastCount = useRef(messages.length);
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else if (messages.length > lastCount.current) {
      setUnread((n) => n + (messages.length - lastCount.current));
    }
    lastCount.current = messages.length;
  }, [messages.length, atBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const bot = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(bot);
    if (bot) setUnread(0);
  };

  const jumpBottom = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setAtBottom(true); setUnread(0);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading conversation…
      </div>
    );
  }

  if (!plan) return <div className="flex-1 flex items-center justify-center text-muted-foreground">Conversation not found.</div>;

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Ambient emerald glow + faint grid kill the empty-black feel */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[640px] h-[320px] bg-emerald-500/[0.04] blur-3xl rounded-full" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 60% 50% at 50% 30%, black 40%, transparent 100%)',
          }}
        />
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {groups.map((g, gi) => (
            <section key={gi} className="relative pl-3">
              <span
                className={`absolute left-0 top-1 bottom-1 w-px ${
                  g.section === 'execution' ? 'bg-emerald-500/30' : 'bg-white/[0.06]'
                }`}
              />
              <SectionDivider label={SECTION_LABELS[g.section]} ts={g.ts} />
              <div className="mt-3 space-y-3">
                {g.items.map((m) => {
                  if (m.kind === 'user') return <UserBubble key={m.id} text={m.text} ts={m.ts} />;
                  if (m.kind === 'system') return <SystemMessage key={m.id} text={m.text} />;
                  if (m.kind === 'handoff')
                    return <HandoffRow key={m.id} fromAgentId={m.fromAgentId} toAgentId={m.toAgentId} />;
                  if (m.kind === 'approval')
                    return <ApprovalCard key={m.id} approval={m.approval} agentId={m.agentId} />;
                  return <AgentBubble key={m.id} msg={m} />;
                })}
              </div>
            </section>
          ))}

          {/* Recommended next step rail */}
          {(() => {
            const running = tasks.some((t) => t.status === 'running' || t.status === 'pending');
            const awaiting = approvals.some((a) => a.status === 'pending');
            const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'complete' || t.status === 'skipped');
            if (plan?.status === 'failed' || (!running && !awaiting && !allDone)) return null;
            const label = awaiting
              ? "Penn is waiting for your approval — review and approve to send."
              : running
              ? 'Agents are working. Open the Workbench on the right to inspect outputs as they arrive.'
              : 'All steps complete. Open the Workbench to inspect outputs or ask Pilot for the next move.';
            return (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 text-[12px] text-[#C9D1D9] flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span>{label}</span>
              </div>
            );
          })()}
        </div>
      </div>

      {!atBottom && unread > 0 && (
        <motion.button
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          onClick={jumpBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg"
        >
          {unread} new message{unread > 1 ? 's' : ''} ↓
        </motion.button>
      )}
    </div>
  );
}
