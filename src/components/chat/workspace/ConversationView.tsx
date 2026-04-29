import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { buildPlanMessages } from '@/lib/chatMessageStream';
import UserBubble from './bubbles/UserBubble';
import SystemMessage from './bubbles/SystemMessage';
import AgentBubble from './bubbles/AgentBubble';
import HandoffRow from './bubbles/HandoffRow';
import ApprovalCard from './bubbles/ApprovalCard';

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
      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-6 py-6 space-y-4">
        {messages.map((m) => {
          if (m.kind === 'user')     return <UserBubble key={m.id} text={m.text} ts={m.ts} />;
          if (m.kind === 'system')   return <SystemMessage key={m.id} text={m.text} />;
          if (m.kind === 'handoff')  return <HandoffRow key={m.id} fromAgentId={m.fromAgentId} toAgentId={m.toAgentId} />;
          if (m.kind === 'approval') return <ApprovalCard key={m.id} approval={m.approval} agentId={m.agentId} />;
          return <AgentBubble key={m.id} msg={m} />;
        })}
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
