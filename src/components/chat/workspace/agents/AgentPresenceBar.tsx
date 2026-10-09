import { resolveAgent } from '@/lib/agentResolver';
import { PUBLIC_AGENT_ORDER } from '@/config/agentRegistry';
import AgentAvatar from './AgentAvatar';
import { liveStateLabel } from '../AgentTypingIndicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Props {
  /** Slug (public or legacy) of the agent this view is talking to. */
  activeSlug?: string | null;
  /** True while that agent is producing a reply (`pending.awaiting`). */
  working?: boolean;
  className?: string;
}

/**
 * The team, one avatar per PUBLIC agent. The roster used the legacy slugs, and
 * two of them (aria, hawk) are both Atlas, so Atlas appeared twice.
 *
 * The active agent gets a thin green ring; the rest stay quiet. Hover says who
 * each agent is and, for the active one, what it is doing — only from state the
 * frontend already has.
 */
export default function AgentPresenceBar({ activeSlug, working, className }: Props) {
  const active = resolveAgent(activeSlug ?? 'pilot').id;
  return (
    <div className={cn('inline-flex items-center gap-1', className)} aria-label="Your team">
      {PUBLIC_AGENT_ORDER.map((id) => {
        const profile = resolveAgent(id);
        const isActive = id === active;
        const status = isActive ? (working ? liveStateLabel(id) : 'In this chat') : null;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-label={`${profile.name}, ${profile.role}${status ? `, ${status}` : ''}`}
                className={cn(
                  'relative inline-flex rounded-full transition-opacity outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                  isActive ? 'opacity-100 ring-1 ring-emerald-400/70 ring-offset-1 ring-offset-background' : 'opacity-50 hover:opacity-90',
                )}
              >
                <AgentAvatar
                  slug={id}
                  size="xs"
                  status={isActive && working ? 'running' : 'idle'}
                  ring={false}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[12px]">
              <span className="font-medium text-[#F2EFEA]">{profile.name}</span>
              <span className="text-[#8B8F96]"> · {profile.role}</span>
              {status && (
                <span className={cn('block mt-0.5', working ? 'text-emerald-300' : 'text-[#8B8F96]')}>{status}</span>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
