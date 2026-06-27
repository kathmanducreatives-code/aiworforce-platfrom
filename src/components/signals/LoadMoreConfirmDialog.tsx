// Load-more confirmation dialog. Explicit confirm before any extra credits.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  estimatedCredits?: number;
  loading?: boolean;
}

export default function LoadMoreConfirmDialog({ open, onOpenChange, onConfirm, estimatedCredits = 4, loading }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#F0F6FC]">
            <Sparkles className="h-4 w-4 text-emerald-300" /> Load 10 more signals?
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Scout will scan additional sources based on your radar settings.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-3 text-[12px] text-neutral-300 space-y-1">
          <div>Estimated cost: <span className="text-emerald-300">~{estimatedCredits} credits</span></div>
          <div className="text-neutral-500">Nothing will be sent. No comments, DMs, or emails go out automatically.</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading}>{loading ? "Scanning…" : "Load more"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
