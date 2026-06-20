import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface Props {
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}

export default function ConversationRowMenu({ onRename, onDelete, className }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className={cn(
            'h-6 w-6 inline-flex items-center justify-center rounded text-[#7D8590] hover:text-[#F0F6FC] hover:bg-white/[0.06] transition-colors',
            className,
          )}
          aria-label="More options"
          type="button"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onRename(); }}>
          <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); onDelete(); }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
