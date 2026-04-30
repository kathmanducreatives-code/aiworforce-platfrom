import type { AgentProfile } from '@/data/agentProfiles';
import { AGENT_BY_NAME } from '@/data/agentProfiles';

/** Renders a user message with @-mention tokens lightly highlighted. */
export default function MentionPill({ text }: { text: string }) {
  const parts = text.split(/(@\w+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith('@')) {
          const name = p.slice(1).toLowerCase();
          const agent: AgentProfile | undefined = AGENT_BY_NAME[name];
          if (agent) {
            return (
              <span
                key={i}
                className="inline-flex items-center px-1 rounded-sm text-[#F0F6FC] bg-white/[0.06]"
              >
                {p}
              </span>
            );
          }
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}
