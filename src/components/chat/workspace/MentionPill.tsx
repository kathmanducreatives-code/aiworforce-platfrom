import { cn } from '@/lib/utils';
import type { AgentProfile } from '@/data/agentProfiles';
import { AGENT_BY_NAME } from '@/data/agentProfiles';

/** Renders a user message with @-mention pills highlighted. */
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
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded-md text-primary bg-primary/15 border border-primary/30 font-medium',
                )}
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
