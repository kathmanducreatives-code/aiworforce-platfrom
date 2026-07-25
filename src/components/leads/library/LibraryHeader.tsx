import { Button } from "@/components/ui/button";
import { Plus, Upload, Download, FolderPlus } from "lucide-react";

interface Props {
  onAddLead: () => void;
  onImport: () => void;
  onExport: () => void;
  onCreateList: () => void;
}

export function LibraryHeader({ onAddLead, onImport, onExport, onCreateList }: Props) {
  return (
    <header className="flex items-start justify-between gap-4 pb-3">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-medium">
          Lead Operations
        </div>
        <h1 className="mt-1 text-[22px] font-semibold text-foreground tracking-tight leading-tight">
          Lead Library
        </h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Research, qualify, and prepare the right accounts for review.
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
          onClick={onImport}
          title="Import CSV"
          aria-label="Import"
        >
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
          onClick={onExport}
          title="Export CSV"
          aria-label="Export"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
          onClick={onAddLead}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add lead
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs bg-primary/90 hover:bg-primary text-primary-foreground border-0"
          onClick={onCreateList}
        >
          <FolderPlus className="h-3.5 w-3.5 mr-1" /> Create list
        </Button>
      </div>
    </header>
  );
}
