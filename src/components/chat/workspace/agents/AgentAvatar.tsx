import { useState } from 'react';
import { cn } from '@/lib/utils';
import { resolveAgent } from '@/lib/agentResolver';

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Status = 'idle' | 'thinking' | 'running' | 'done' | 'blocked';

const SIZE_PX: Record<Size, number> = { xs: 20, sm: 28, md: 36, lg: 44 };
const FONT_PX: Record<Size, number> = { xs: 10, sm: 12, md: 14, lg: 18 };

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
  const accent = profile.accentHex ?? '#7D8590';
  const [failed, setFailed] = useState(false);
  const showImage = !!profile.image && !failed;
  const pulse = status === 'thinking' || status === 'running';

  return (
    <div
      className={cn('relative shrink-0 rounded-full', className)}
      style={{ width: px, height: px }}
      title={title ?? profile.name}
      aria-label={profile.name}
    >
      <div
        className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
        style={{
          backgroundColor: showImage ? 'transparent' : `${accent}26`,
          boxShadow: ring ? `0 0 0 1.5px ${accent}66` : undefined,
        }}
      >
        {showImage ? (
          <img
            src={profile.image as string}
            alt={profile.name}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span
            className="font-semibold leading-none"
            style={{ color: accent, fontSize: FONT_PX[size] }}
          >
            {profile.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      {pulse && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ boxShadow: `0 0 0 2px ${accent}66`, opacity: 0.5 }}
          aria-hidden
        />
      )}
    </div>
  );
}
