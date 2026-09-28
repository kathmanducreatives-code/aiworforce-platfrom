import { Plus, Upload, Download, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import DepartmentHeader, { DEPT_ACTION, DEPT_ICON_ACTION } from "@/components/layout/department/DepartmentHeader";
import { GHOST_ACTION, PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/layout/workspaceStyles";

interface Props {
  onAddLead: () => void;
  onImport: () => void;
  onExport: () => void;
  onCreateList: () => void;
}

export function LibraryHeader({ onAddLead, onImport, onExport, onCreateList }: Props) {
  return (
    <DepartmentHeader
      className="pb-2"
      eyebrow="Growth · Leads"
      title="Lead Library"
      description="Research, qualify, and prepare the right accounts for review."
      actions={
        <>
          <button className={cn(DEPT_ICON_ACTION, GHOST_ACTION)} onClick={onImport} title="Import CSV" aria-label="Import">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button className={cn(DEPT_ICON_ACTION, GHOST_ACTION)} onClick={onExport} title="Export CSV" aria-label="Export">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button className={cn(DEPT_ACTION, SECONDARY_ACTION)} onClick={onAddLead}>
            <Plus className="h-3.5 w-3.5" /> Add lead
          </button>
          <button className={cn(DEPT_ACTION, "px-3.5", PRIMARY_ACTION)} onClick={onCreateList}>
            <FolderPlus className="h-3.5 w-3.5" /> Create list
          </button>
        </>
      }
    />
  );
}
