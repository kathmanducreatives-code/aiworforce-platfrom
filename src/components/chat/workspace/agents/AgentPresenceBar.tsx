import { resolveAgent } from '@/lib/agentResolver';
import AgentAvatar from './AgentAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ROSTER = ['pilot', 'scout', 'aria', 'hawk', 'penn', 'scribe'] as const;

interface Props {
  /** Slug whose avatar should glow as "active". */
  activeSlug?: string | null;
  className?: string;
}

/**
 * Compact Slack-style team-presence strip. Stateless — accepts an optional
 * `activeSlug` to highlight the agent currently "speaking" or working.
 * Pilot stays present as orchestrator.
 */
export default function AgentPresenceBar({ activeSlug, className }: Props) {
  const active = (activeSlug ?? 'pilot').toLowerCase();
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="text-[10px] uppercase tracking-widest text-[#7D8590] mr-1">Team</span>
      {ROSTER.map((slug) => {
        const profile = resolveAgent(slug);
        const isActive = slug === active;
        const accent = profile.accentHex ?? '#10B981';
        return (
          <Tooltip key={slug}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'relative inline-flex rounded-full transition-all',
                  isActive ? 'opacity-100' : 'opacity-60 hover:opacity-100',
                )}
                style={isActive ? { boxShadow: `0 0 0 2px ${accent}66, 0 0 12px ${accent}55` } : undefined}
              >
                <AgentAvatar
                  slug={slug}
                  size="xs"
                  status={isActive ? 'running' : 'idle'}
                  ring={false}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              <span className="font-medium" style={{ color: accent }}>{profile.name}</span>
              <span className="text-[#9aa4af]"> · {profile.role}</span>
              {isActive && <span className="ml-1 text-emerald-300">· active</span>}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
