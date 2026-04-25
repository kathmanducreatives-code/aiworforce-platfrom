import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, MessageSquarePlus, History, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ChatComposer, { type ComposerSubmit } from './ChatComposer';
import ChatBubble from './ChatBubble';
import PlanningThread, { type PlanStep } from './PlanningThread';
import PlanDetailView from './PlanDetailView';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAllPlans } from '@/hooks/usePlans';
import { submitInstruction } from '@/lib/orchestration';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type ThreadMessage =
  | { kind: 'user'; text: string; ts: string }
  | { kind: 'planning'; steps: PlanStep[]; planId: string }
  | { kind: 'plan_started'; planId: string; summary: string };

/**
 * Persistent bottom chat input rendered globally inside MainLayout.
 * Expands upward into a conversation thread + history sidebar (Claude/ChatGPT-style).
 */
export default function GlobalChatBar() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { plans } = useAllPlans(workspaceId, 30);

  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread, activePlanId]);

  const handleSubmit = async ({ text, mentioned }: ComposerSubmit) => {
    if (!workspaceId) {
      toast.error('Workspace not ready');
      return;
    }
    setExpanded(true);
    setActivePlanId(null);
    setThread((t) => [...t, { kind: 'user', text, ts: new Date().toISOString() }]);

    try {
      const result = await submitInstruction(workspaceId, text, {
        agentSlug: mentioned?.id,
      });
      if (result.steps && result.steps.length > 1 && !mentioned) {
        // Show planning thread before transitioning to live plan view
        setThread((t) => [
          ...t,
          { kind: 'planning', steps: result.steps!, planId: result.plan_id },
        ]);
        setTimeout(() => {
          setThread((t) => [
            ...t,
            { kind: 'plan_started', planId: result.plan_id, summary: result.plan_summary },
          ]);
          setActivePlanId(result.plan_id);
        }, steps_duration(result.steps.length));
      } else {
        setThread((t) => [
          ...t,
          { kind: 'plan_started', planId: result.plan_id, summary: result.plan_summary },
        ]);
        setActivePlanId(result.plan_id);
      }
    } catch (e) {
      toast.error('Could not dispatch', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const newConversation = () => {
    setActivePlanId(null);
    setThread([]);
    setExpanded(false);
  };

  const openPastPlan = (planId: string) => {
    setActivePlanId(planId);
    setThread([]);
    setExpanded(true);
    setHistoryOpen(false);
  };

  return (
    <>
      {/* Expanded conversation panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-[120px] left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4"
          >
            <div className="rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl shadow-[0_30px_80px_-20px_hsl(var(--background)/0.8)] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Conversation with your AI workforce
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setHistoryOpen((o) => !o)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="History"
                  >
                    <History className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={newConversation}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="New conversation"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setExpanded(false)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Collapse"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex max-h-[60vh]">
                {/* History sidebar */}
                {historyOpen && (
                  <div className="w-56 shrink-0 border-r border-border/50 overflow-auto">
                    <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Past conversations
                    </div>
                    <ul className="px-2 pb-2 space-y-0.5">
                      {plans.length === 0 && (
                        <li className="px-2 py-2 text-xs text-muted-foreground">No plans yet.</li>
                      )}
                      {plans.map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => openPastPlan(p.id)}
                            className={cn(
                              'w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors',
                              activePlanId === p.id
                                ? 'bg-primary/10 text-foreground'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            <div className="line-clamp-2">{p.user_instruction}</div>
                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                              {new Date(p.created_at).toLocaleDateString()}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Thread */}
                <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
                  {thread.length === 0 && !activePlanId && (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      Start a new instruction below.
                    </div>
                  )}

                  {thread.map((m, i) => {
                    if (m.kind === 'user') {
                      return <ChatBubble key={i} role="user" text={m.text} timestamp={m.ts} />;
                    }
                    if (m.kind === 'planning') {
                      return <PlanningThread key={i} steps={m.steps} />;
                    }
                    if (m.kind === 'plan_started') {
                      return (
                        <ChatBubble
                          key={i}
                          role="system"
                          text="Live execution starting"
                        />
                      );
                    }
                    return null;
                  })}

                  {activePlanId && (
                    <div className="pt-2 border-t border-border/40">
                      <PlanDetailView planId={activePlanId} compact />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent input bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none">
        <div
          className={cn(
            'pointer-events-auto px-4 pb-4 pt-3',
            'bg-gradient-to-t from-background via-background/95 to-background/0',
          )}
          // sit above the OperativeDock when expanded
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <div className="flex-1">
              <ChatComposer onSubmit={handleSubmit} />
            </div>
            {!expanded && thread.length > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="h-11 w-11 rounded-xl border border-border/70 bg-card/90 backdrop-blur-xl hover:border-primary/50 hover:text-primary text-muted-foreground transition-all flex items-center justify-center"
                aria-label="Expand conversation"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function steps_duration(n: number): number {
  // 550ms per step + ~1.3s for the "starting now" tail
  return n * 550 + 1300;
}
