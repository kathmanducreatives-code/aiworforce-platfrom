import type { LeadRow } from "@/lib/leadLibrary/types";
import { StatusPill } from "./StatusPill";
import { formatDistanceToNowStrict } from "date-fns";

interface RunGroup {
  key: string;
  query: string | null;
  method: string | null;
  createdAt: string;
  leads: LeadRow[];
}

export function SearchRunsTab({ rows, onOpenRun }: { rows: LeadRow[]; onOpenRun: (key: string) => void }) {
  const groups = new Map<string, RunGroup>();
  for (const r of rows) {
    if (!r.strongestSource) continue;
    const key = r.strongestSource.searchRunId ?? r.strongestSource.searchQuery ?? `no-run-${r.strongestSource.discoveryMethod ?? "unknown"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        query: r.strongestSource.searchQuery,
        method: r.strongestSource.discoveryMethod,
        createdAt: r.createdAt,
        leads: [],
      };
      groups.set(key, g);
    }
    g.leads.push(r);
    if (r.createdAt > g.createdAt) g.createdAt = r.createdAt;
  }
  const list = Array.from(groups.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (list.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
        <div className="text-sm text-foreground">No search runs recorded</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Search runs will appear here once Scout or a workflow discovers new accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {list.map((g) => (
        <button
          key={g.key}
          onClick={() => onOpenRun(g.key)}
          className="w-full rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 p-4 text-left transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{g.query ?? "Untitled search"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[g.method ?? "Unknown method", formatDistanceToNowStrict(new Date(g.createdAt)) + " ago"].join(" · ")}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 shrink-0">
              <StatusPill label={`${g.leads.length} found`} tone="info" />
              <StatusPill label={`${g.leads.filter((l) => l.accountStatus === "qualified").length} qualified`} tone="success" />
              <StatusPill label={`${g.leads.filter((l) => l.contactReadiness === "verified").length} contact-ready`} tone="muted" />
              <StatusPill label={`${g.leads.filter((l) => l.opener?.status === "draft_ready").length} draft-ready`} tone="muted" />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
