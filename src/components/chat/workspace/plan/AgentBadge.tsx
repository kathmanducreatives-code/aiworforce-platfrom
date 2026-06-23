import { resolveAgent } from '@/lib/agentResolver';
import AgentAvatar from '../agents/AgentAvatar';

export function agentColor(slug: string | null | undefined) {
  return resolveAgent(slug).accentHex ?? '#7D8590';
}

export default function AgentBadge({ slug, size = 18 }: { slug: string | null | undefined; size?: number }) {
  const profile = resolveAgent(slug);
  const hex = profile.accentHex ?? '#7D8590';
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <AgentAvatar slug={profile.id} size="xs" />
      <span className="text-[12px] font-medium" style={{ color: hex }}>{profile.name}</span>
      <span className="text-[11px] text-[#7D8590]">· {profile.role}</span>
    </span>
  );
}
