import { motion } from 'framer-motion';

const SUGGESTIONS = [
  { text: 'Find 10 React engineers in London', agent: 'Scout' },
  { text: "Draft outreach for today's leads", agent: 'Penn' },
  { text: 'What changed at our top 3 competitors today?', agent: 'Hawk' },
  { text: 'Write a LinkedIn post about our Q4 wins', agent: 'Scribe' },
];

interface Props {
  onPickPrompt?: (text: string) => void;
}

export default function EmptyState({ onPickPrompt }: Props) {
  const pick = (text: string) => {
    onPickPrompt?.(text);
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: text }));
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-8 pb-6">
      <div className="max-w-[640px]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
          <span className="text-[11px] uppercase tracking-wider text-[#7D8590]">Ready</span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="text-[28px] font-medium text-[#F0F6FC] leading-tight mt-3"
        >
          What needs to get done?
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="text-[13.5px] text-[#848d97] mt-2 leading-relaxed"
        >
          Ask Pilot for custom work, or use Workflows for repeatable playbooks.
        </motion.p>

        <ul className="mt-8">
          {SUGGESTIONS.map((s, i) => (
            <motion.li
              key={s.text}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.25 + i * 0.06 }}
            >
              <button
                onClick={() => pick(s.text)}
                className="w-full flex items-center justify-between py-3 border-b border-white/[0.06] hover:bg-white/[0.04] transition-colors duration-150 px-2 -mx-2 rounded"
              >
                <span className="text-[14px] text-[#F0F6FC] text-left">{s.text}</span>
                <span className="text-[12px] text-[#7D8590] shrink-0 ml-4">{s.agent}</span>
              </button>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
