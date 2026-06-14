import { cn } from '@/lib/utils';
import { statusDot, statusLabel, type AgentStatusKind } from './agents';

export default function StatusPill({ status, label, className }: { status: AgentStatusKind; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full',
        'bg-white/[0.04] border border-white/[0.08] backdrop-blur-md',
        'text-[11px] text-neutral-300',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', statusDot[status], status === 'working' && 'animate-pulse')} />
      {label ?? statusLabel[status]}
    </span>
  );
}
