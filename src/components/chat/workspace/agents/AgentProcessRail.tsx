import { resolveAgent } from '@/lib/agentResolver';
import AgentAvatar from './AgentAvatar';
import { cn } from '@/lib/utils';

interface Step {
  slug: string | null;
  status?: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
}

interface Props {
  steps: Step[];
  className?: string;
}

/**
 * Thin vertical agent rail: avatar column with connector lines. Highlights the
 * currently-running step, dims skipped/pending. Pure presentational.
 */
export default function AgentProcessRail({ steps, className }: Props) {
  if (!steps.length) return null;
  return (
    <ol className={cn('flex flex-col items-center gap-0 pt-1', className)}>
      {steps.map((s, i) => {
        const profile = resolveAgent(s.slug);
        const accent = profile.accentHex ?? '#7D8590';
        const dim = s.status === 'pending' || s.status === 'skipped';
        const active = s.status === 'running';
        return (
          <li key={i} className="flex flex-col items-center">
            <span
              className={cn('relative inline-flex rounded-full transition-opacity', dim && 'opacity-40')}
              style={active ? { boxShadow: `0 0 0 2px ${accent}88, 0 0 10px ${accent}66` } : undefined}
              title={`${profile.name} · ${s.status ?? 'pending'}`}
            >
              <AgentAvatar slug={profile.id} size="xs" ring={false} status={active ? 'running' : 'idle'} />
            </span>
            {i < steps.length - 1 && (
              <span
                className="w-px h-3 my-0.5"
                style={{ background: `linear-gradient(180deg, ${accent}55, transparent)` }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
