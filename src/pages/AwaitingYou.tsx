import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { deptColor, DockDept } from '@/data/dockAgents';

interface ApprovalItem {
  id: string;
  agent: string;
  dept: DockDept;
  description: string;
}

const INITIAL: ApprovalItem[] = [
  {
    id: '1',
    agent: 'Aria',
    dept: 'talent',
    description: 'Aria shortlisted 3 candidates — approve to send interview invites',
  },
  {
    id: '2',
    agent: 'Penn',
    dept: 'growth',
    description: 'Penn drafted 5 outreach emails for Series A leads — approve to send',
  },
  {
    id: '3',
    agent: 'Scout',
    dept: 'talent',
    description: 'Scout sourced 18 SaaS founders in London — approve to add to CRM',
  },
  {
    id: '4',
    agent: 'Hawk',
    dept: 'intelligence',
    description: 'Hawk flagged 2 competitor pricing changes — approve to alert team',
  },
];

export default function AwaitingYou() {
  const [items, setItems] = useState<ApprovalItem[]>(INITIAL);

  const remove = (id: string, action: 'approved' | 'review') => {
    setItems((p) => p.filter((i) => i.id !== id));
    toast(action === 'approved' ? 'Approved' : 'Opening for review', {
      description: action === 'approved' ? 'Your AI workforce is on it.' : 'Loading the full output...',
    });
  };

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        {/* Header */}
        <div className="mb-8 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Inbox className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Awaiting Your Approval</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Your AI workforce completed work and needs your green light. {items.length} item{items.length === 1 ? '' : 's'} pending.
            </p>
          </div>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          <AnimatePresence>
            {items.map((item) => {
              const dept = deptColor[item.dept];
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
                  transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                  className="relative flex items-center gap-4 rounded-xl border border-white/10 bg-[#13151C]/80 pl-4 pr-3 py-3.5 border-l-[3px] border-l-amber-500/70"
                >
                  {/* Agent avatar + name */}
                  <div className="flex items-center gap-3 shrink-0 min-w-[110px]">
                    <div className={cn(
                      'w-9 h-9 rounded-full ring-2 flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br',
                      dept.ring, dept.bg,
                    )}>
                      {item.agent[0]}
                    </div>
                    <span className="text-sm font-semibold text-white">{item.agent}</span>
                  </div>

                  {/* Description */}
                  <p className="flex-1 text-sm text-zinc-300 leading-snug">{item.description}</p>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => remove(item.id, 'review')}
                      className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                    >
                      <Eye className="h-3 w-3" />
                      Review first
                    </button>
                    <button
                      onClick={() => remove(item.id, 'approved')}
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

          {items.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-12 text-center"
            >
              <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 items-center justify-center mb-3">
                <Check className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-white">All clear</p>
              <p className="text-xs text-zinc-500 mt-1">Your AI workforce is running autonomously.</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
