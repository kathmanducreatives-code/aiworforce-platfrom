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
    <div className="sticky bottom-3 z-20 mt-3 rounded-xl border border-primary/40 bg-card/95 backdrop-blur-xl px-3 py-2 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.4)]">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-foreground">{selectedRows.length} selected</span>
        {ineligible > 0 && (
          <span className="text-muted-foreground">· {ineligible} not ready (missing source or verified buyer)</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addToList}><ListPlus className="h-3 w-3 mr-1" />Add to list</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addTag}><Tag className="h-3 w-3 mr-1" />Add tag</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={markContacted}><CheckCircle2 className="h-3 w-3 mr-1" />Mark contacted</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={archive}><Archive className="h-3 w-3 mr-1" />Archive</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportCsv}><Download className="h-3 w-3 mr-1" />Export CSV</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}><X className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
