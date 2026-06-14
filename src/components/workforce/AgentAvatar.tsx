import { AGENTS, accentClasses, type AgentId, type AgentStatusKind, statusDot } from './agents';
import { cn } from '@/lib/utils';

interface Props {
  id: AgentId;
  size?: number;
  status?: AgentStatusKind;
  badge?: number | string | null;
  withRing?: boolean;
  active?: boolean;
  className?: string;
}

export default function AgentAvatar({ id, size = 44, status, badge, withRing = true, active, className }: Props) {
  const a = AGENTS[id];
  const c = accentClasses[a.accent];
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c2 = size / 2;
  const dashArray = 2 * Math.PI * r;
  const offset = status === 'idle' ? dashArray * 0.6 : 0;

  return (
    <div className={cn('relative inline-block', className)} style={{ width: size, height: size }}>
      {withRing && (
        <svg width={size} height={size} className="absolute inset-0 -rotate-90 pointer-events-none">
          <circle cx={c2} cy={c2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
          <circle
            cx={c2} cy={c2} r={r}
            fill="none"
            stroke={c.stroke}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            strokeDashoffset={offset}
            className="transition-all duration-500"
            opacity={active ? 1 : 0.85}
          />
        </svg>
      )}
      <div
        className={cn(
          'absolute inset-[3px] rounded-full flex items-center justify-center font-semibold text-white/95 select-none',
          'bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08]',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)]',
          active && c.glow,
        )}
        style={{ fontSize: size * 0.36 }}
      >
        <span className={c.text}>{a.initial}</span>
        {/* glossy highlight */}
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), transparent 45%)' }}
        />
      </div>
      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-black/60',
            statusDot[status],
            status === 'working' && 'animate-pulse',
          )}
        />
      )}
      {badge != null && badge !== 0 && badge !== '0' && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center border border-black/60 tabular-nums">
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  );
}
