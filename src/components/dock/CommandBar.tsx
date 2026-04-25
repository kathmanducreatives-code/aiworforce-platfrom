import { Search } from 'lucide-react';

interface Props {
  onOpen: () => void;
}

export default function CommandBar({ onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-2.5 w-full max-w-md h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 transition-all text-left"
    >
      <Search className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0" />
      <span className="flex-1 text-xs font-mono text-zinc-500 group-hover:text-zinc-400 truncate">
        Command your workforce...
      </span>
      <kbd className="text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-zinc-400 shrink-0">
        ⌘K
      </kbd>
    </button>
  );
}
