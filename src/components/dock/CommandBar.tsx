import { Search } from 'lucide-react';

interface Props {
  onOpen: () => void;
}

export default function CommandBar({ onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-2.5 w-full max-w-xs h-8 px-3 rounded-lg border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/20 transition-all duration-200 text-left"
    >
      <Search className="h-3.5 w-3.5 text-neutral-500 group-hover:text-emerald-400 transition-colors shrink-0" />
      <span className="flex-1 text-[12px] text-neutral-500 group-hover:text-neutral-300 truncate">
        Command center...
      </span>
      <kbd className="text-[9px] font-mono bg-white/[0.01] border border-white/[0.06] rounded px-1.5 py-0.5 text-neutral-500 shrink-0">
        ⌘K
      </kbd>
    </button>
  );
}
