import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useConversationActions } from '@/hooks/useConversationActions';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string | null;
  currentTitle: string | null;
}

export default function RenameConversationDialog({ open, onOpenChange, conversationId, currentTitle }: Props) {
  const { renameConversation } = useConversationActions();
  const [title, setTitle] = useState(currentTitle ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setTitle(currentTitle ?? ''); }, [open, currentTitle]);

  const save = async () => {
    if (!conversationId) return;
    setSaving(true);
    const ok = await renameConversation(conversationId, title);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Give this chat a clear, searchable name.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder="Conversation title"
          maxLength={120}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !title.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
