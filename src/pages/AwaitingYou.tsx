import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye, Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import AgentAvatar from '@/components/agents/AgentAvatar';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApprovals } from '@/hooks/useApprovals';
import { decideApproval } from '@/lib/orchestration';
import { useState } from 'react';

export default function AwaitingYou() {
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const { approvals, loading } = useApprovals(workspaceId);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setPendingIds((p) => new Set(p).add(id));
    try {
      await decideApproval(id, action);
      toast(action === 'approve' ? 'Approved' : 'Rejected', {
        description: action === 'approve'
          ? 'Your AI workforce is on it.'
          : 'The plan has been halted.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      toast.error('Failed to update', { description: msg });
      setPendingIds((p) => { const n = new Set(p); n.delete(id); return n; });
    }
  };

  const isReady = !wsLoading && !loading;
  const visible = approvals.filter((a) => !pendingIds.has(a.id));

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        <div className="mb-8 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Inbox className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Awaiting Your Approval</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your AI workforce completed work and needs your green light.{' '}
              {isReady && `${visible.length} item${visible.length === 1 ? '' : 's'} pending.`}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {visible.map((item) => {
              const agentName = item.title.split(' ')[0] || 'Agent';
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
                  transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                  className="relative flex items-center gap-4 rounded-xl border border-border bg-card/80 pl-4 pr-3 py-3.5 border-l-[3px] border-l-amber-500/70"
                >
                  <div className="flex items-center gap-3 shrink-0 min-w-[110px]">
                    <AgentAvatar agentName={agentName} size="sm" />
                    <span className="text-sm font-semibold text-foreground">{agentName}</span>
                  </div>

                  <p className="flex-1 text-sm text-muted-foreground leading-snug">
                    {item.description ?? item.title}
                  </p>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => decide(item.id, 'reject')}
                      className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Reject
                    </button>
                    <button
                      onClick={() => decide(item.id, 'approve')}
                      className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                    >
                      <Check className="h-3 w-3" />
                      Approve
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isReady && visible.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-border bg-muted/20 p-12 text-center"
            >
              <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 items-center justify-center mb-3">
                <Check className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground mt-1">Your AI workforce is running autonomously.</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
