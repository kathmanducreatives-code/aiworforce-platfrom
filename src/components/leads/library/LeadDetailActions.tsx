// Wired lead actions for the canonical Lead Library detail drawer.
//
// Replaces the previous dead "Run Find decision-makers" text with real controls
// that go through the SAME production path the Workbench uses
// (runLeadAction → supabase.functions.invoke('run-agent')). The lead_candidate
// id comes from the canonical read model, workspace/session are guarded, and the
// canonical query is invalidated on success. No new Edge Function invocation
// implementation, no backend change.

import { useCallback, useState } from "react";
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
  leadActionResultMessage,
  researchActionLabel,
  decisionMakerActionLabel,
  type LeadDetailActionKind,
} from "@/lib/leadLibrary/leadDetailActions";

export function LeadDetailActions({ lead, onDone }: { lead: LeadRow; onDone: () => void }) {
  const { workspaceId } = useWorkspace();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState<LeadDetailActionKind | null>(null);

  // Compute the gate once (session/workspace/actionable-lead). Used for the
  // disabled state + tooltip so we never render a clickable-looking dead control.
  const gate = planLeadDetailAction({ lead, activeWorkspaceId: workspaceId, hasSession: !!session }, "find_decision_makers");
  const disabledReason = gate.ok ? null : gate.message;

  const run = useCallback(async (kind: LeadDetailActionKind) => {
    // Idempotency: one action at a time; a second click while loading is ignored.
    if (running) return;

    const plan = planLeadDetailAction({ lead, activeWorkspaceId: workspaceId, hasSession: !!session }, kind);
    if (!plan.ok) { toast.error(plan.message); return; }

    setRunning(kind);
    try {
      const result = await runLeadAction(plan.args);
      const m = leadActionResultMessage(result);
      if (m.tone === "success") {
        toast.success(kind === "find_decision_makers" ? "Decision-maker search complete." : "Company research complete.");
        // Canonical refetch — never patch optimistic contacts/research into state.
        await qc.invalidateQueries({ queryKey: ["lead-library", workspaceId, "canonical-v1"] });
        onDone(); // keep the drawer open; refresh its underlying row
      } else if (m.tone === "blocked") {
        toast.warning(m.message);
      } else {
        toast.error(m.message);
      }
    } catch {
      // A thrown invoke never reached execution.
      toast.error("The action did not reach the server. No provider ran — try again.");
    } finally {
      setRunning(null);
    }
  }, [running, lead, workspaceId, session, qc, onDone]);

  const researchLabel = researchActionLabel(lead.canonical?.research.status);
  const dmLabel = decisionMakerActionLabel(!!lead.selectedRecipient);
  const disabled = !gate.ok || running !== null;

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
