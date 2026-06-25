import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HELP_CONTENT, type HelpTopic } from './helpContent';

interface InfoHintProps {
  topic: HelpTopic;
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * Subtle inline "(i)" help icon. Click/tap opens a small popover with the
 * plain-English explanation from helpContent.ts. Works on touch and desktop.
 */
export default function InfoHint({ topic, size = 'xs', className }: InfoHintProps) {
  const entry = HELP_CONTENT[topic];
  if (!entry) return null;
  const dims = size === 'sm' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${entry.label}`}
          className={
            'inline-flex items-center justify-center rounded-full text-neutral-500 hover:text-emerald-300 transition-colors align-middle ' +
            (className ?? '')
          }
          onClick={(e) => e.stopPropagation()}
        >
          <Info className={dims} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-3.5 rounded-xl border border-emerald-500/15 bg-[#0a0c0a]/95 backdrop-blur-md text-[13px] leading-[1.55] text-neutral-200 shadow-2xl"
      >
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-300/80 mb-1.5">
          {entry.label}
        </div>
        <div>{entry.text}</div>
      </PopoverContent>
    </Popover>
  );
}
