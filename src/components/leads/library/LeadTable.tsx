import { formatDistanceToNowStrict } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";
import {
  type LeadRow,
  ACCOUNT_STATUS_LABEL,
  ENGAGEMENT_STATUS_LABEL,
  fitTierLabel,
  nextStepFor,
  readinessSummary,
} from "@/lib/leadLibrary/types";
import { ExternalLink, Linkedin } from "lucide-react";

export function LeadTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: LeadRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(!!v)} />
              </th>
              <Th>Company</Th>
              <Th>Source</Th>
              <Th>Why selected</Th>
              <Th>Fit</Th>
              <Th>Selected buyer</Th>
              <Th>Readiness</Th>
              <Th>Opener</Th>
              <Th>Engagement</Th>
              <Th>Next step</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <LeadRowView key={r.id} r={r} selected={selected.has(r.id)} onToggle={() => onToggle(r.id)} onOpen={() => onOpen(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>;
}

function LeadRowView({ r, selected, onToggle, onOpen }: {
  r: LeadRow; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const readiness = readinessSummary(r);
  return (
    <tr
      className={cn(
        "border-t border-border/40 transition-colors cursor-pointer hover:bg-primary/5",
        selected && "bg-primary/10",
      )}
      onClick={onOpen}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} />
      </td>
      <td className="px-3 py-3 min-w-[200px]">
        <div className="font-medium text-foreground">{r.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {r.domain && <span>{r.domain}</span>}
          {r.linkedinUrl && (
            <a href={r.linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary">
              <Linkedin className="h-3 w-3 inline" />
            </a>
          )}
          {r.websiteUrl && (
            <a href={r.websiteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary">
              <ExternalLink className="h-3 w-3 inline" />
            </a>
          )}
        </div>
        <div className="flex gap-1 mt-1">
          {r.industry && <StatusPill label={r.industry} tone="muted" />}
          {r.employeeCount && <StatusPill label={r.employeeCount} tone="muted" />}
          {r.possibleDuplicateOf && <StatusPill label="Possible duplicate" tone="warning" />}
        </div>
      </td>
      <td className="px-3 py-3 min-w-[220px]">
        {r.strongestSource ? (
          <div className="text-xs">
            <div className="text-foreground line-clamp-1">{r.strongestSource.headline ?? r.strongestSource.sourceType ?? "Signal"}</div>
            <div className="text-muted-foreground line-clamp-1">
              {[r.strongestSource.sourceType, r.strongestSource.discoveryMethod].filter(Boolean).join(" · ")}
            </div>
            {r.sources.length > 1 && <div className="text-primary/70 mt-0.5">{r.sources.length} sources</div>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">Source not recorded</span>
        )}
      </td>
      <td className="px-3 py-3 min-w-[200px]">
        <div className="text-xs text-foreground line-clamp-2">{r.whySelected ?? <span className="text-muted-foreground italic">—</span>}</div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-semibold text-foreground tabular-nums">{r.fitScore ?? "—"}</span>
          <StatusPill label={fitTierLabel(r.fitTier)} tone={r.fitTier === "strong" ? "success" : r.fitTier === "poor" ? "danger" : "neutral"} />
          <StatusPill label={ACCOUNT_STATUS_LABEL[r.accountStatus]} tone={r.accountStatus === "qualified" ? "success" : r.accountStatus === "disqualified" ? "danger" : "muted"} />
        </div>
      </td>
      <td className="px-3 py-3 min-w-[180px]">
        {r.selectedRecipient ? (
          <div className="text-xs">
            <div className="font-medium text-foreground">{r.selectedRecipient.fullName ?? "Unknown"}</div>
            <div className="text-muted-foreground">{r.selectedRecipient.title ?? "—"}</div>
            <div className="flex gap-1 mt-0.5">
              {r.selectedRecipient.verified && <StatusPill label="Verified" tone="success" />}
              {r.selectedRecipient.linkedinUrl && <StatusPill label="LinkedIn" tone="info" />}
              {r.selectedRecipient.email ? <StatusPill label="Email" tone="info" /> : <StatusPill label="No email" tone="muted" />}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">No buyer selected</span>
        )}
      </td>
      <td className="px-3 py-3 min-w-[140px]">
        <div className="flex flex-col gap-0.5 text-[11px]">
          <ReadinessRow label="Research" val={readiness.research} />
          <ReadinessRow label="Buyer" val={readiness.buyer} />
          <ReadinessRow label="Opener" val={readiness.opener} />
        </div>
      </td>
      <td className="px-3 py-3 min-w-[220px]">
        {r.opener ? (
          <div className="text-xs">
            <div className="line-clamp-2 text-foreground">{r.opener.bodyPreview}</div>
            <div className="flex gap-1 mt-0.5">
              <StatusPill label={r.opener.status === "approved" ? "Approved" : "Draft ready"} tone={r.opener.status === "approved" ? "success" : "info"} />
              <StatusPill label={`${r.opener.evidenceCount} evidence`} tone="muted" />
              <StatusPill label="Approval required · Nothing sent" tone="warning" />
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {!r.strongestSource ? "Research company first" : !r.selectedRecipient?.verified ? "Find a verified buyer first" : "Not generated"}
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusPill
          label={ENGAGEMENT_STATUS_LABEL[r.engagementStatus]}
          tone={r.engagementStatus === "replied" || r.engagementStatus === "meeting" || r.engagementStatus === "won" ? "success" : r.engagementStatus === "lost" ? "danger" : "muted"}
        />
        {r.primaryChannel && <div className="text-[11px] text-muted-foreground mt-1 capitalize">{r.primaryChannel}</div>}
      </td>
      <td className="px-3 py-3 min-w-[140px]">
        <span className="text-xs text-foreground">{nextStepFor(r)}</span>
      </td>
      <td className="px-3 py-3 min-w-[140px]">
        {r.lastActivity ? (
          <div className="text-xs">
            <div className="text-foreground">{r.lastActivity.type}</div>
            <div className="text-muted-foreground">{formatDistanceToNowStrict(new Date(r.lastActivity.at))} ago</div>
            {r.lastActivity.manual && <StatusPill label="Manual" tone="muted" />}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">No activity</span>
        )}
      </td>
    </tr>
  );
}

function ReadinessRow({ label, val }: { label: string; val: string }) {
  const tone: "success" | "warning" | "muted" =
    val === "ready" || val === "verified" ? "success" : val === "waiting" || val === "review" ? "warning" : "muted";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <StatusPill label={val === "ready" ? "Ready" : val === "verified" ? "Verified" : val === "waiting" ? "Waiting" : val === "review" ? "Review" : "Missing"} tone={tone} />
    </div>
  );
}
