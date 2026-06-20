import { motion } from 'framer-motion';
import { resolveAgent } from '@/lib/agentResolver';
import AgentAvatar from './agents/AgentAvatar';
import { cn } from '@/lib/utils';

export type AgentVerb =
  | 'thinking' | 'coordinating' | 'planning' | 'reviewing'
  | 'sourcing' | 'searching' | 'scraping'
  | 'ranking' | 'scoring' | 'prioritizing'
  | 'researching' | 'enriching' | 'reading'
  | 'drafting' | 'writing' | 'summarizing';

export function inferVerbForAgent(slug?: string | null, hint?: string | null): AgentVerb {
  const s = (slug ?? 'pilot').toLowerCase();
  const h = (hint ?? '').toLowerCase();
  if (s === 'scout')  return /scrap/.test(h) ? 'scraping' : /search/.test(h) ? 'searching' : 'sourcing';
  if (s === 'aria')   return /score/.test(h) ? 'scoring' : /priorit/.test(h) ? 'prioritizing' : 'ranking';
  if (s === 'hawk')   return /enrich/.test(h) ? 'enriching' : /read|website/.test(h) ? 'reading' : 'researching';
  if (s === 'penn')   return 'drafting';
  if (s === 'scribe') return /summar/.test(h) ? 'summarizing' : /report/.test(h) ? 'writing' : 'writing';
  if (/plan/.test(h)) return 'planning';
  if (/review/.test(h)) return 'reviewing';
  if (/coord/.test(h)) return 'coordinating';
  return 'thinking';
}

interface Props {
  slug?: string | null;
  verb?: AgentVerb;
  hint?: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * Slack/Telegram-style "{Name} is {verb}…" indicator with agent avatar
 * and a soft accent pulse. Used in chat transcripts and agent bubbles.
 */
export default function AgentTypingIndicator({ slug, verb, hint, className, compact }: Props) {
  const profile = resolveAgent(slug);
  const v: AgentVerb = verb ?? inferVerbForAgent(slug, hint);
  const accent = profile.accentHex ?? '#10B981';

  return (
    <div className={cn('flex items-start gap-3 animate-fade-in', className)}>
      <AgentAvatar slug={profile.id} size={compact ? 'xs' : 'sm'} status="thinking" />
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[12.5px] font-semibold text-[#E6EDF3]">{profile.name}</span>
            <span className="text-[11px]" style={{ color: accent }}>· {profile.role}</span>
          </div>
        )}
        <div
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full border"
          style={{
            backgroundColor: `${accent}10`,
            borderColor: `${accent}33`,
          }}
        >
          <span className="text-[12px] text-[#C9D1D9]">
            <span style={{ color: accent }} className="font-medium">{profile.name}</span>{' '}
            is {v}
          </span>
          <span className="flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: accent }}
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -1.5, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
