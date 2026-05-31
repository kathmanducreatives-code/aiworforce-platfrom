import { AGENT_BY_ID } from '@/data/agentProfiles';

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6', aria: '#8B5CF6', penn: '#10B981', hawk: '#14B8A6', scribe: '#A855F7', pilot: '#F59E0B',
};

export function agentColor(slug: string | null | undefined) {
  return AGENT_HEX[slug ?? ''] ?? '#7D8590';
}

export default function AgentBadge({ slug, size = 18 }: { slug: string | null | undefined; size?: number }) {
  const s = (slug ?? '').toLowerCase();
  const profile = AGENT_BY_ID[s];
  const hex = agentColor(s);
  const name = profile?.name ?? (s ? s[0].toUpperCase() + s.slice(1) : 'Agent');
  const letter = name.charAt(0).toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span
        className="rounded-full flex items-center justify-center shrink-0"
        style={{
          width: size, height: size,
          backgroundColor: `${hex}26`, color: hex,
          fontSize: 10, fontWeight: 700, lineHeight: 1,
        }}
        aria-hidden
      >{letter}</span>
      <span className="text-[12px] font-medium" style={{ color: hex }}>{name}</span>
    </span>
  );
}
