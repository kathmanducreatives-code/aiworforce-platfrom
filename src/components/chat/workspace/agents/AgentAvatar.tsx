import AgentPortrait from '@/components/agents/AgentPortrait';
import { cn } from '@/lib/utils';
import { resolveAgent } from '@/lib/agentResolver';

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Status = 'idle' | 'thinking' | 'running' | 'done' | 'blocked';

const SIZE_PX: Record<Size, number> = { xs: 20, sm: 28, md: 36, lg: 44 };

interface Props {
  slug?: string | null;
  size?: Size;
  status?: Status;
  ring?: boolean;
  className?: string;
  title?: string;
}

/**
 * Shared chat-workspace agent avatar.
 * - Uses local PNGs from src/assets/agents/ when present
 * - Falls back to a tinted initials circle (Pilot is always initials)
 * - onError → initials fallback so a broken file never renders a broken-image icon
 */
export default function AgentAvatar({
  slug, size = 'sm', status = 'idle', ring = true, className, title,
}: Props) {
  const profile = resolveAgent(slug);
  const px = SIZE_PX[size];
  const pulse = status === 'thinking' || status === 'running';

  return (
    <div
      className={cn('relative shrink-0 rounded-full', className)}
      style={{ width: px, height: px }}
      title={title ?? profile.name}
      aria-label={profile.name}
    >
      <AgentPortrait agentId={profile.id} name={profile.name} size={px} ring={ring} active={pulse} decorative />

    </div>
  );
}
