import { PUBLIC_AGENTS } from "@/config/agentRegistry";
import type { LeadRow } from "@/lib/leadLibrary/types";
import { cn } from "@/lib/utils";
import AgentStatus from "@/components/layout/department/AgentStatus";
import { METRIC_STRIP_H } from "@/components/layout/workspaceStyles";

interface Props {
  rows: LeadRow[];
  /** Atlas's live status word (useDepartmentAgentStatus), or null while unknown. */
  status?: string | null;
  className?: string;
}

export function AtlasStrip({ rows, status = null, className }: Props) {
  const atlas = PUBLIC_AGENTS.atlas;
  const indexed = rows.length;
  const draftsReady = rows.filter(
    (r) => r.opener?.status === "draft_ready" || r.opener?.status === "approved",
  ).length;

  return (
    <div className={cn("flex items-center px-3.5 rounded-xl ag-glass max-w-[420px]", METRIC_STRIP_H, className)}>
      <AgentStatus
        className="flex-1"
        agentId="atlas"
        name={atlas.name}
        role={atlas.title}
        src={atlas.avatar}
        status={status}
        meta={
          <>
            <span className="text-foreground/90 font-medium">{indexed}</span> accounts indexed
            <span className="mx-1.5 text-white/15">·</span>
            <span className="text-foreground/90 font-medium">{draftsReady}</span> drafts ready
          </>
        }
      />
    </div>
  );
}
