import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { profileById } from '@/lib/agentDeptIndex';
import { deptDot, deptText, deptRing } from '@/data/agentProfiles';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, ThumbsUp, ThumbsDown, Wand2 } from 'lucide-react';
import { useState } from 'react';
import OutputRenderer from '../output/OutputRenderer';
import AmbientShimmer from '../effects/AmbientShimmer';
import type { ChatMessage } from '@/lib/chatMessageStream';
import { toast } from 'sonner';

interface Props {
  msg: Extract<ChatMessage, { kind: 'agent' }>;
}

export default function AgentBubble({ msg }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const profile = profileById(agents, msg.agentId);
  const dept = profile?.department ?? 'operations';
  const initial = (profile?.name ?? '?').charAt(0);
  const rel = useRelativeTime(msg.ts);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const tone = deptText[dept];
  const dot = deptDot[dept];
  const ring = deptRing[dept];

  return (
    <div className="flex items-start gap-3">
      <div className="relative">
        <div className={cn(
          'h-9 w-9 rounded-full ring-2 flex items-center justify-center text-sm font-semibold bg-card border border-border/60',
          ring, tone,
          msg.state !== 'done' && msg.state !== 'failed' && 'animate-pulse',
        )}>
          {profile?.image ? (
            <img src={profile.image} alt="" className="h-full w-full object-cover rounded-full" />
          ) : initial}
        </div>
      </div>

      <div className="min-w-0 flex-1 max-w-[78%]">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('text-xs font-semibold', tone)}>{profile?.name ?? 'Agent'}</span>
          <span className={cn('h-1 w-1 rounded-full', dot)} />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{dept}</span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              'relative overflow-hidden rounded-2xl rounded-bl-sm bg-card/80 border border-border/60 px-4 py-3 text-sm text-foreground/95 leading-relaxed',
              `shadow-[0_0_0_1px_hsl(var(--border)/0.4),0_8px_24px_-12px_hsl(var(--background)/0.8)]`,
            )}>
              <AmbientShimmer active={msg.state === 'working' || msg.state === 'thinking'} tone={dot} />

              {msg.state === 'thinking' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className={cn('text-xs', tone)}>{profile?.name ?? 'Agent'} is thinking</span>
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className={cn('h-1.5 w-1.5 rounded-full', dot)}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </span>
                </div>
              )}

              {msg.state === 'working' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className={cn('h-3.5 w-3.5 animate-spin', tone)} />
                    <span className="text-xs text-foreground/90">{msg.task.description}</span>
                  </div>
                  <div className="h-1 rounded-full bg-foreground/10 overflow-hidden">
                    <motion.div
                      className={cn('h-full', dot)}
                      initial={{ width: '0%' }}
                      animate={{ width: '90%' }}
                      transition={{ duration: 12, ease: 'easeOut' }}
                    />
                  </div>
                  {profile && (
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {profile.model}
                    </div>
                  )}
                </div>
              )}

              {msg.state === 'done' && (
                <div className="space-y-3">
                  <OutputRenderer output={msg.task.output} />
                  <div className="flex items-center justify-between pt-2 border-t border-border/40">
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {msg.task.output?.usage?.total_tokens != null && (
                        <span>{msg.task.output.usage.total_tokens} tokens</span>
                      )}
                      {msg.task.started_at && msg.task.finished_at && (
                        <span>
                          {((new Date(msg.task.finished_at).getTime() - new Date(msg.task.started_at).getTime()) / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
                        className={cn('p-1 rounded hover:bg-foreground/5 transition-colors',
                          feedback === 'up' ? 'text-primary' : 'text-muted-foreground')}
                        type="button" aria-label="Helpful"
                      ><ThumbsUp className="h-3 w-3" /></button>
                      <button
                        onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
                        className={cn('p-1 rounded hover:bg-foreground/5 transition-colors',
                          feedback === 'down' ? 'text-destructive' : 'text-muted-foreground')}
                        type="button" aria-label="Not helpful"
                      ><ThumbsDown className="h-3 w-3" /></button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(typeof msg.task.output === 'string'
                            ? msg.task.output
                            : JSON.stringify(msg.task.output, null, 2));
                          toast.success('Output copied');
                        }}
                        className="ml-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary px-2 py-0.5 rounded border border-border/60"
                        type="button"
                      ><Wand2 className="h-3 w-3" /> Use this</button>
                    </div>
                  </div>
                </div>
              )}

              {msg.state === 'failed' && (
                <div className="text-sm text-destructive">Task failed.</div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">{new Date(msg.ts).toLocaleString()}</TooltipContent>
        </Tooltip>
        <div className="text-[10px] text-muted-foreground/70 mt-1">{rel}</div>
      </div>
    </div>
  );
}
