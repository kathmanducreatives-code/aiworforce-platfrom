import type { LeadRow } from "@/lib/leadLibrary/types";
import { StatusPill } from "./StatusPill";

export function ListsTab({ rows, onOpenList }: { rows: LeadRow[]; onOpenList: (list: string) => void }) {
  const lists = new Map<string, LeadRow[]>();
  for (const r of rows) for (const l of r.lists) {
    const arr = lists.get(l) ?? [];
    arr.push(r);
    lists.set(l, arr);
  }
  const entries = Array.from(lists.entries());
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
        <div className="text-sm text-foreground">No lists yet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Select leads in the All leads tab and use "Add to list" to create your first list. Lists are workspace-scoped.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {entries.map(([name, ls]) => (
        <button
          key={name}
          onClick={() => onOpenList(name)}
          className="rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 p-4 text-left transition-colors"
        >
          <div className="font-medium text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground mt-1">{ls.length} lead{ls.length === 1 ? "" : "s"}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            <StatusPill label={`${ls.filter((l) => l.contactReadiness === "verified").length} contact-ready`} tone="success" />
            <StatusPill label={`${ls.filter((l) => l.opener?.status === "draft_ready").length} draft-ready`} tone="info" />
          </div>
        </button>
      ))}
    </div>
  );
}
