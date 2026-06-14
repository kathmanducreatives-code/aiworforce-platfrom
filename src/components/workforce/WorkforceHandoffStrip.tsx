import { cn } from '@/lib/utils';
import type { AgentId } from './agents';
import { DEPT_CONFIG } from './departmentConfig';

const FLOW: { id: AgentId; label: string }[] = [
  { id: 'scout', label: 'Scout finds signals' },
  { id: 'aria', label: 'Aria ranks leads' },
  { id: 'penn', label: 'Penn drafts outreach' },
  { id: 'pilot', label: 'Pilot asks approval' },
  { id: 'scribe', label: 'Scribe reports results' },
];

interface Props {
  activeId: AgentId;
}

export default function WorkforceHandoffStrip({ activeId }: Props) {
  return (
    <div className="flex items-center flex-wrap gap-2 px-1">
      {FLOW.map((step, i) => {
        const active = step.id === activeId;
        const hex = DEPT_CONFIG[step.id].ringHex;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] uppercase tracking-wider font-mono transition-all',
                'bg-white/[0.03] border border-white/[0.06] text-neutral-400',
              )}
              style={
                active
                  ? {
                      color: hex,
                      borderColor: `${hex}66`,
                      background: `${hex}14`,
                      boxShadow: `0 0 18px ${hex}33`,
                    }
                  : undefined
              }
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: active ? hex : 'rgba(255,255,255,0.2)' }}
              />
              {step.label}
            </span>
            {i < FLOW.length - 1 && <span className="text-neutral-600 text-xs">→</span>}
          </div>
        );
      })}
    </div>
  );
}
