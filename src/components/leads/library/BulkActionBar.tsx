import { Button } from "@/components/ui/button";
import { X, Download, Archive, Tag, ListPlus, CheckCircle2 } from "lucide-react";
import { downloadCsv, leadsToCsv, type LeadRow } from "@/lib/leadLibrary/types";
import { loadLocalAug, saveLocalAug } from "@/hooks/leadLibrary/useLeadLibrary";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function BulkActionBar({
  selectedRows,
  onClear,
  workspaceId,
}: {
  selectedRows: LeadRow[];
  onClear: () => void;
  workspaceId: string;
}) {
  const qc = useQueryClient();
  if (selectedRows.length === 0) return null;

  const ineligible = selectedRows.filter((r) => !r.strongestSource || !r.selectedRecipient?.verified).length;

  const markContacted = () => {
    const aug = loadLocalAug(workspaceId);
    for (const r of selectedRows) {
      aug.manualEngagement[r.id] = "contacted";
      aug.activity.unshift({
        id: crypto.randomUUID(),
        leadId: r.id,
        at: new Date().toISOString(),
        type: "Engagement marked Contacted",
        detail: "bulk manual",
        owner: null,
        manual: true,
      });
    }
    saveLocalAug(workspaceId, aug);
    qc.invalidateQueries({ queryKey: ["lead-library", workspaceId] });
    toast.success(`Marked ${selectedRows.length} lead${selectedRows.length === 1 ? "" : "s"} as contacted`);
  };

  const archive = () => {
    const aug = loadLocalAug(workspaceId);
    for (const r of selectedRows) {
      aug.activity.unshift({
        id: crypto.randomUUID(), leadId: r.id, at: new Date().toISOString(),
        type: "Archived", detail: "bulk manual", owner: null, manual: true,
      });
    }
    saveLocalAug(workspaceId, aug);
    qc.invalidateQueries({ queryKey: ["lead-library", workspaceId] });
    toast.success("Archived selected leads locally");
  };

  const addTag = () => {
    const tag = window.prompt("Tag to add");
    if (!tag) return;
    const aug = loadLocalAug(workspaceId);
    for (const r of selectedRows) {
      const cur = new Set(aug.tags[r.id] ?? []);
      cur.add(tag);
      aug.tags[r.id] = Array.from(cur);
    }
    saveLocalAug(workspaceId, aug);
    qc.invalidateQueries({ queryKey: ["lead-library", workspaceId] });
    toast.success(`Tagged ${selectedRows.length} lead(s) with #${tag}`);
  };

  const addToList = () => {
    const list = window.prompt("List to add to");
    if (!list) return;
    const aug = loadLocalAug(workspaceId);
    for (const r of selectedRows) {
      const cur = new Set(aug.lists[r.id] ?? []);
      cur.add(list);
      aug.lists[r.id] = Array.from(cur);
    }
    saveLocalAug(workspaceId, aug);
    qc.invalidateQueries({ queryKey: ["lead-library", workspaceId] });
    toast.success(`Added ${selectedRows.length} lead(s) to "${list}"`);
  };

  const exportCsv = () => {
    downloadCsv(`leads-${Date.now()}.csv`, leadsToCsv(selectedRows));
  };

  return (
    <div className="sticky bottom-3 z-20 mt-3 rounded-2xl border border-primary/30 bg-[rgba(6,20,15,0.85)] backdrop-blur-2xl px-4 py-2.5 shadow-[0_20px_60px_-15px_rgba(16,185,129,0.5)]">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-2 pr-2 border-r border-white/[0.06]">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)] animate-pulse" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-primary/90 font-medium">Atlas</span>
        </div>
        <span className="font-semibold text-foreground">{selectedRows.length} selected</span>
        {ineligible > 0 && (
          <span className="text-muted-foreground">· {ineligible} not ready</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={addToList}><ListPlus className="h-3 w-3 mr-1" />Add to list</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={addTag}><Tag className="h-3 w-3 mr-1" />Add tag</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={markContacted}><CheckCircle2 className="h-3 w-3 mr-1" />Mark contacted</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={archive}><Archive className="h-3 w-3 mr-1" />Archive</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={exportCsv}><Download className="h-3 w-3 mr-1" />Export CSV</Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onClear}><X className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
