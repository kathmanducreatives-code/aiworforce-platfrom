import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RenameConversationDialog from './RenameConversationDialog';
import DeleteConversationDialog from './DeleteConversationDialog';

interface Props {
  conversationId: string;
  currentTitle: string | null;
}

export default function ChatHeaderMenu({ conversationId, currentTitle }: Props) {
  const [rename, setRename] = useState(false);
  const [del, setDel] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-7 w-7 inline-flex items-center justify-center rounded text-[#7D8590] hover:text-[#F0F6FC] hover:bg-white/[0.06] transition-colors"
            aria-label="Chat options"
            type="button"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setRename(true); }}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setDel(true); }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameConversationDialog open={rename} onOpenChange={setRename}
        conversationId={conversationId} currentTitle={currentTitle} />
      <DeleteConversationDialog open={del} onOpenChange={setDel}
        conversationId={conversationId} title={currentTitle} />
    </>
  );
}
