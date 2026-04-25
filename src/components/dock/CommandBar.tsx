import { Search } from 'lucide-react';

interface Props {
  onOpen: () => void;
}

export default function CommandBar({ onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-2.5 w-full max-w-md h-9 px-3 rounded-lg border border-border/60 bg-foreground/[0.03] hover:bg-foreground/[0.06] hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-all text-left"
    >
      <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      <span className="flex-1 text-xs font-mono text-muted-foreground group-hover:text-foreground/80 truncate">
        Command your workforce...
      </span>
      <kbd className="text-[10px] font-mono bg-background/60 border border-border/60 rounded px-1.5 py-0.5 text-muted-foreground shrink-0">
        ⌘K
      </kbd>
    </button>
  );
}
