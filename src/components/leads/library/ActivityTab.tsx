import type { LeadRow } from "@/lib/leadLibrary/types";
import { formatDistanceToNowStrict } from "date-fns";
import { loadLocalAug } from "@/hooks/leadLibrary/useLeadLibrary";
import { StatusPill } from "./StatusPill";

export function ActivityTab({ rows, workspaceId, onOpenLead }: { rows: LeadRow[]; workspaceId: string; onOpenLead: (id: string) => void }) {
  const aug = loadLocalAug(workspaceId);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const events: Array<{
    id: string;
    at: string;
    type: string;
    leadId: string;
    manual: boolean;
    owner?: string | null;
  }> = [];

  for (const r of rows) {
    events.push({ id: `${r.id}-created`, at: r.createdAt, type: "Lead discovered", leadId: r.id, manual: false });
    if (r.opener?.generatedAt) events.push({ id: `${r.id}-op`, at: r.opener.generatedAt, type: "Personalized opener generated", leadId: r.id, manual: false });
  }
  for (const a of aug.activity) {
    if (byId.has(a.leadId)) events.push({ id: a.id, at: a.at, type: a.type, leadId: a.leadId, manual: true, owner: a.owner });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
        <div className="text-sm text-foreground">No activity yet</div>
        <p className="mt-1 text-xs text-muted-foreground">Activity across all leads will appear here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 divide-y divide-border/40">
      {events.slice(0, 300).map((e) => {
        const lead = byId.get(e.leadId);
        return (
          <button
            key={e.id}
            onClick={() => onOpenLead(e.leadId)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-primary/5 text-sm"
          >
            <span className="text-foreground">{e.type}</span>
            {lead && <span className="text-muted-foreground text-xs">· {lead.name}</span>}
            {e.manual && <StatusPill label="Manual" tone="muted" />}
            <span className="ml-auto text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(e.at))} ago</span>
          </button>
        );
      })}
    </div>
  );
}
