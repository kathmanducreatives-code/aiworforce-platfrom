import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { profileById } from '@/lib/agentDeptIndex';
import { decideApproval, type DBApproval } from '@/lib/orchestration';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  approval: DBApproval;
  agentId: string | null;
}

export default function ApprovalCard({ approval, agentId }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const profile = profileById(agents, agentId);
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState<'approve' | 'reject' | null>(null);
  const [resolved, setResolved] = useState<null | 'approved' | 'rejected'>(
    approval.status === 'approved' ? 'approved' : approval.status === 'rejected' ? 'rejected' : null,
  );

  const decide = async (action: 'approve' | 'reject') => {
    setResolving(action);
    try {
      await decideApproval(approval.id, action);
      setResolved(action === 'approve' ? 'approved' : 'rejected');
      toast.success(action === 'approve' ? 'Approved — resuming' : 'Rejected');
    } catch (e) {
      toast.error('Action failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setResolving(null);
    }
  };

  const desc = approval.description ?? '';
  const preview = desc.length > 200 ? desc.slice(0, 200) + '…' : desc;

  return (
    <motion.div
      layout
      className="relative rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] overflow-hidden"
      style={{ boxShadow: '0 0 0 1px hsl(45 100% 60% / 0.2), inset 4px 0 0 hsl(45 100% 60% / 0.6)' }}
    >
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-amber-400 font-semibold">
            {resolved ? (resolved === 'approved' ? 'Approved' : 'Rejected') : 'Waiting for your approval'}
          </div>
          {profile && <div className="text-xs text-muted-foreground">{profile.name}</div>}
        </div>
        <div className="text-sm font-medium text-foreground">{approval.title}</div>
        {desc && (
          <div className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
            {expanded ? desc : preview}
            {desc.length > 200 && (
              <button onClick={() => setExpanded(!expanded)} className="ml-2 text-xs text-primary inline-flex items-center gap-0.5">
                {expanded ? <>Less <ChevronUp className="h-3 w-3" /></> : <>More <ChevronDown className="h-3 w-3" /></>}
              </button>
            )}
          </div>
        )}

        {!resolved && (
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => decide('approve')}
              disabled={!!resolving}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-all disabled:opacity-50',
              )}
            >
              <Check className="h-4 w-4" /> Approve
            </button>
            <button
              onClick={() => decide('reject')}
              disabled={!!resolving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-destructive/15 border border-destructive/40 text-destructive hover:bg-destructive/25 text-sm font-medium transition-all disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        )}
        {resolved && (
          <div className="text-xs text-muted-foreground pt-1">
            {resolved === 'approved' ? `Approved · ${profile?.name ?? 'Agent'} resumed.` : 'Stopped.'}
          </div>
        )}
      </div>
    </motion.div>
  );
}
