import { cn } from '@/lib/utils';
import type { AgentId } from './agents';
import { DEPT_CONFIG } from './departmentConfig';

const FLOW: { id: AgentId; label: string }[] = [
  { id: 'scout', label: 'Scout · signals' },
  { id: 'aria', label: 'Aria · ranks' },
  { id: 'penn', label: 'Penn · drafts' },
  { id: 'pilot', label: 'Pilot · approves' },
  { id: 'scribe', label: 'Scribe · reports' },
];

interface Props {
  activeId: AgentId;
}

export default function WorkforceHandoffStrip({ activeId }: Props) {
  return (
    <div className="flex items-center flex-wrap gap-1.5 px-0.5">
      {FLOW.map((step, i) => {
        const active = step.id === activeId;
        const hex = DEPT_CONFIG[step.id].ringHex;
        return (
          <div key={step.id} className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 h-6 px-2 rounded text-[10.5px] uppercase tracking-[0.06em] font-medium transition-colors',
                'bg-white/[0.02] border border-white/[0.05] text-neutral-500',
              )}
              style={
                active
                  ? {
                      color: hex,
                      borderColor: `${hex}55`,
                      background: `${hex}10`,
                    }
                  : undefined
              }
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ background: active ? hex : 'rgba(255,255,255,0.18)' }}
              />
              {step.label}
            </span>
            {i < FLOW.length - 1 && <span className="text-neutral-700 text-[10px]">→</span>}
          </div>
        );
      })}
    </div>
  );
}
