import { cn } from '@/lib/utils';
import { AI_MODELS } from '@/data/aiModelLogos';
import type { AgentModelKey } from '@/data/agentProfiles';

interface Props {
  model: AgentModelKey;
  size?: 'sm' | 'md';
  className?: string;
}

export default function ModelBadge({ model, size = 'sm', className }: Props) {
  const m = AI_MODELS[model];
  if (!m) return null;
  const isSm = size === 'sm';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold',
        m.pillClassName,
        isSm ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-sm overflow-hidden',
          m.chipBg,
          isSm ? 'w-3.5 h-3.5' : 'w-4 h-4',
        )}
      >
        <img src={m.logo} alt={m.label} className="w-full h-full object-contain" />
      </span>
      {m.label}
    </span>
  );
}
