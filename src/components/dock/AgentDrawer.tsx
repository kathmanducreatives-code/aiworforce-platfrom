import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DockAgent, deptColor, modelBadge } from '@/data/dockAgents';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Send } from 'lucide-react';

interface Props {
  agent: DockAgent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendCommand: (agent: DockAgent) => void;
}

export default function AgentDrawer({ agent, open, onOpenChange, onSendCommand }: Props) {
  const navigate = useNavigate();
  if (!agent) return null;
  const dept = deptColor[agent.department];
  const model = modelBadge[agent.model];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] bg-[#0C0D10]/95 backdrop-blur-2xl border-l border-white/10 text-white p-0"
      >
        <SheetHeader className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-12 h-12 rounded-full ring-2 flex items-center justify-center text-sm font-bold text-white shrink-0 bg-gradient-to-br',
              dept.ring, dept.bg,
            )}>
              {agent.name[0]}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <SheetTitle className="text-white text-base font-semibold">{agent.name}</SheetTitle>
              <p className="text-xs text-zinc-400 mt-0.5">{agent.role}</p>
            </div>
            <span className={cn(
              'text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full',
              agent.status === 'active'
                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                : 'text-zinc-500 bg-white/5 border border-white/10',
            )}>
              {agent.status === 'active' ? '● Live' : '○ Idle'}
            </span>
          </div>
        </SheetHeader>

        <div className="p-5 space-y-5 overflow-y-auto h-[calc(100vh-100px)]">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Current Task</p>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm text-white mb-3">{agent.currentTask}</p>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  className={cn('h-full rounded-full bg-gradient-to-r', dept.bg.replace(/\/30/g, '/80'))}
                  initial={{ width: 0 }}
                  animate={{ width: `${agent.progress}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                />
              </div>
              <p className="text-xs text-zinc-500 mt-2 tabular-nums">{agent.progress}% complete</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Powered by</span>
            <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded border', model.className)}>
              {model.label}
            </span>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Live Activity</p>
            <div className="space-y-2">
              {agent.recentActivity.map((a, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5"
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', dept.dot)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200">{a.text}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{a.time}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={() => { onOpenChange(false); navigate(agent.href); }}
              className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 transition-colors"
            >
              View full output
              <ArrowRight className="h-3 w-3" />
            </button>
            <button
              onClick={() => onSendCommand(agent)}
              className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
            >
              <Send className="h-3 w-3" />
              Send command
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
