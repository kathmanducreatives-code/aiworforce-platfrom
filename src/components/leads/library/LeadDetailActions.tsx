// Wired lead actions for the canonical Lead Library detail drawer.
//
// Replaces the previous dead "Run Find decision-makers" text with real controls
// that go through the SAME production path the Workbench uses
// (runLeadAction → supabase.functions.invoke('run-agent')). The lead_candidate
// id + its matching plan come from the canonical read model, workspace/session
// are guarded, a SYNCHRONOUS single-flight guard prevents duplicate requests,
// and the canonical query is invalidated on success (which live-refreshes the
// drawer). No new Edge Function invocation, no backend change.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/hooks/useAuth";
import { runLeadAction } from "@/lib/leadActions";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  planLeadDetailAction,
  createLeadActionController,
  researchActionLabel,
  decisionMakerActionLabel,
  type LeadDetailActionKind,
} from "@/lib/leadLibrary/leadDetailActions";

export function LeadDetailActions({ lead }: { lead: LeadRow }) {
  const { workspaceId } = useWorkspace();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState<LeadDetailActionKind | null>(null);

  // Latest values captured in a ref so the stable controller reads fresh deps.
  const depsRef = useRef({ lead, workspaceId, session });
  depsRef.current = { lead, workspaceId, session };

  // Controller created ONCE. Its in-flight flag is a plain closure variable, so
  // two clicks in the same tick can never both fire a request.
  const controllerRef = useRef<ReturnType<typeof createLeadActionController>>();
  if (!controllerRef.current) {
    controllerRef.current = createLeadActionController({
      runLeadAction,
      onStateChange: setRunning,
      onSuccess: async (kind) => {
        const ws = depsRef.current.workspaceId;
        toast.success(kind === "find_decision_makers" ? "Decision-maker search complete." : "Company research complete.");
        // Single canonical refetch — LeadLibrary derives the open drawer's lead
        // live from these rows, so this both refreshes the drawer and keeps it
        // open. No optimistic contact/research is fabricated; no second refetch.
        await qc.invalidateQueries({ queryKey: ["lead-library", ws, "canonical-v1"] });
      },
      onBlocked: (m) => toast.warning(m),
      onError: (m) => toast.error(m),
    });
  }

  const gate = planLeadDetailAction({ lead, activeWorkspaceId: workspaceId, hasSession: !!session }, "find_decision_makers");
  const disabledReason = gate.ok ? null : gate.message;
  const disabled = !gate.ok || running !== null;

  const run = (kind: LeadDetailActionKind) => {
    const { lead: l, workspaceId: ws, session: s } = depsRef.current;
    const plan = planLeadDetailAction({ lead: l, activeWorkspaceId: ws, hasSession: !!s }, kind);
    void controllerRef.current!.run(plan, kind);
  };

  const researchLabel = researchActionLabel(lead.canonical?.research.status);
  const dmLabel = decisionMakerActionLabel(!!lead.selectedRecipient);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={disabled}
          aria-label={researchLabel}
          title={disabledReason ?? researchLabel}
          onClick={() => run("research_company")}
        >
          {running === "research_company"
            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Researching company…</>
            : <><Search className="h-3 w-3 mr-1" /> {researchLabel}</>}
        </Button>

        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={disabled}
          aria-label={dmLabel}
          title={disabledReason ?? dmLabel}
          onClick={() => run("find_decision_makers")}
        >
          {running === "find_decision_makers"
            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Finding decision-makers…</>
            : <><Users className="h-3 w-3 mr-1" /> {dmLabel}</>}
        </Button>
      </div>
      {disabledReason && (
        <p className="text-[11px] text-muted-foreground" role="note">{disabledReason}</p>
      )}
      <p className="text-[11px] text-muted-foreground">Runs on the current account. Approval-gated — nothing is sent.</p>
    </div>
  );
}
