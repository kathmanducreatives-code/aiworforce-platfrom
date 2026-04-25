import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface HandoffEvent {
  kind: 'handoff';
  time: string;
  from: { agent: string; dept: 'talent' | 'growth' | 'content' | 'intelligence'; action: string };
  to:   { agent: string; dept: 'talent' | 'growth' | 'content' | 'intelligence'; action: string };
}

const deptBg: Record<string, string> = {
  talent: 'bg-emerald-500',
  growth: 'bg-blue-500',
  content: 'bg-violet-500',
  intelligence: 'bg-amber-500',
};

const deptStroke: Record<string, string> = {
  talent: 'stroke-emerald-500',
  growth: 'stroke-blue-500',
  content: 'stroke-violet-500',
  intelligence: 'stroke-amber-500',
};

export default function HandoffFeedItem({ event }: { event: HandoffEvent }) {
  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div className="absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full border-2 border-[#1a2332] bg-zinc-400" />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-xl border border-white/10 bg-[#1f2a3d]/70 px-4 py-3.5 overflow-hidden"
      >
        {/* HANDOFF badge */}
        <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">
          Handoff
        </span>

        <div className="flex items-center gap-3 mb-2.5">
          {/* From avatar */}
          <div className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0',
            deptBg[event.from.dept],
          )}>
            {event.from.agent[0]}
          </div>

          {/* Animated arrow */}
          <svg width="60" height="14" viewBox="0 0 60 14" className="shrink-0">
            <line
              x1="2" y1="7" x2="50" y2="7"
              className={cn(deptStroke[event.from.dept])}
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.9s" repeatCount="indefinite" />
            </line>
            <path d="M50 3 L57 7 L50 11" fill="none" className={cn(deptStroke[event.to.dept])} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>

          {/* To avatar */}
          <div className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0',
            deptBg[event.to.dept],
          )}>
            {event.to.agent[0]}
          </div>

          <span className="text-[11px] text-zinc-500 font-mono ml-auto mr-16">{event.time}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-zinc-500 mb-0.5 text-[10px] uppercase tracking-wider font-semibold">{event.from.agent}</p>
            <p className="text-zinc-300">{event.from.action}</p>
          </div>
          <div>
            <p className="text-zinc-500 mb-0.5 text-[10px] uppercase tracking-wider font-semibold">{event.to.agent}</p>
            <p className="text-zinc-300">{event.to.action}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
