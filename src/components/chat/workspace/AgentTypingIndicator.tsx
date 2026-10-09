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

/**
 * The short live state shown beside an agent's name while it works:
 * "Pilot · Planning", "Lyra · Checking signals". Keyed on the PUBLIC agent
 * (legacy slugs resolve first), so Scout's sourcing reads as Lyra's.
 */
const STATE_BY_VERB: Record<AgentVerb, string> = {
  thinking: 'Thinking', coordinating: 'Coordinating', planning: 'Planning', reviewing: 'Reviewing',
  sourcing: 'Checking signals', searching: 'Searching', scraping: 'Reading sources',
  ranking: 'Ranking accounts', scoring: 'Scoring fit', prioritizing: 'Prioritizing',
  researching: 'Researching', enriching: 'Enriching', reading: 'Reading sources',
  drafting: 'Drafting', writing: 'Writing', summarizing: 'Summarizing',
};
const DEFAULT_STATE: Record<string, string> = {
  pilot: 'Planning', lyra: 'Checking signals', atlas: 'Researching', mira: 'Drafting', orion: 'Organizing pipeline',
};

export function liveStateLabel(slug?: string | null, verb?: AgentVerb, hint?: string | null): string {
  const profile = resolveAgent(slug);
  if (verb) return STATE_BY_VERB[verb];
  const inferred = inferVerbForAgent(slug, hint);
  return inferred === 'thinking' ? (DEFAULT_STATE[profile.id] ?? 'Thinking') : STATE_BY_VERB[inferred];
}

interface Props {
  slug?: string | null;
  verb?: AgentVerb;
  hint?: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * The agent that is working right now: avatar, "{Name} · {state}" and a small
 * animated dot. Animation only while it is active — this component is only
 * rendered then.
 */
export default function AgentTypingIndicator({ slug, verb, hint, className, compact }: Props) {
  const profile = resolveAgent(slug);
  const state = liveStateLabel(slug, verb, hint);
  const accent = profile.accentHex ?? '#10B981';

  return (
    <div className={cn('flex items-center gap-3 animate-fade-in', className)} role="status" aria-live="polite">
      <AgentAvatar slug={profile.id} size={compact ? 'xs' : 'sm'} status="thinking" />
      <div className="inline-flex items-center gap-2 text-[13px]">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: accent }}
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
        <span className="font-medium text-[#F2EFEA]">{profile.name}</span>
        <span className="text-[#8B8F96]">· {state}</span>
      </div>
    </div>
  );
}
