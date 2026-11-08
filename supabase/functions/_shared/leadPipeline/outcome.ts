// MISSION OUTCOME — what the user's request got, never "a provider returned rows"
// (MRLE Phase 0, audit 2026-11-07 X5 / X6).
//
//   completed                 qualified ≥ requested
//   completed_with_shortfall  0 < qualified < requested
//   needs_verification        nothing qualified, some candidates still open (pending)
//   no_results                the run finished and nothing matched (nothing qualified or open)
//   blocked                   refused before any purchase (the plan or the contract)
//   failed                    an error stopped the run (spend, if any, is reported)
//   cancelled                 stopped by the user
//
// Only QUALIFIED companies count toward the requested number. Pure.

export type MissionOutcomeStatus =
  | "completed" | "completed_with_shortfall" | "needs_verification" | "no_results" | "blocked" | "failed" | "cancelled";

export interface MissionOutcome {
  status: MissionOutcomeStatus;
  requested: number | null;
  qualified: number;
  needsVerification: number;
  rejected: number;
  /** requested − qualified, when a number was requested and not met. */
  shortfall: number | null;
  /** One sentence for the Workbench banner. */
  summary: string;
  /** What the user can do next, when there is something to do. */
  nextStep: string | null;
  /** The spend the run reports, labelled by its basis (an estimate is never presented as billed). */
  spend: { apifyUsd: number; leadoceanRecords: number; basis: "estimate" | "provider_reported" | "none" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function missionOutcome(i: {
  requested: number | null;
  qualified: number; pending: number; rejected: number;
  runStatus: "completed" | "partial" | "blocked" | "failed" | "cancelled";
  reason?: string | null;
  /** The REQUIRED requirements companies still lack evidence for (labels), for the next step. */
  openRequirements?: string[];
  spend?: { apifyUsd: number; leadoceanRecords: number; basis: "estimate" | "provider_reported" };
}): MissionOutcome {
  const spend = i.spend && (i.spend.apifyUsd > 0 || i.spend.leadoceanRecords > 0) ? i.spend : { apifyUsd: 0, leadoceanRecords: 0, basis: "none" as const };
  const base = { requested: i.requested, qualified: i.qualified, needsVerification: i.pending, rejected: i.rejected, spend };
  const open = (i.openRequirements ?? []).filter(Boolean);
  const openText = open.length ? ` on ${open.join(", ")}` : "";
  if (i.runStatus === "blocked") return { ...base, status: "blocked", shortfall: null, summary: `Nothing was run: ${i.reason ?? "the plan was blocked"}.`, nextStep: "Answer the questions on the plan, then plan again." };
  if (i.runStatus === "cancelled") return { ...base, status: "cancelled", shortfall: i.requested !== null ? Math.max(0, i.requested - i.qualified) : null, summary: `Cancelled: ${plural(i.qualified, "company", "companies")} qualified before the stop.`, nextStep: null };
  if (i.runStatus === "failed") return { ...base, status: "failed", shortfall: i.requested !== null ? Math.max(0, i.requested - i.qualified) : null, summary: `The run stopped on an error${i.reason ? `: ${i.reason}` : ""}.`, nextStep: "Nothing is retried automatically. Review the error, then plan a new run." };
  const shortfall = i.requested !== null && i.qualified < i.requested ? i.requested - i.qualified : null;
  if (i.requested !== null ? i.qualified >= i.requested : i.qualified > 0) {
    return { ...base, status: "completed", shortfall: null, summary: `${plural(i.qualified, "company", "companies")} qualified${i.requested !== null ? ` of ${i.requested} requested` : ""}.`, nextStep: null };
  }
  if (i.qualified > 0) {
    return { ...base, status: "completed_with_shortfall", shortfall,
      summary: `Only ${plural(i.qualified, "company", "companies")} qualified of ${i.requested} requested${i.pending ? `; ${i.pending} still need verification${openText}` : ""}.`,
      nextStep: i.pending ? "Verify the open candidates, or run another discovery within a new approval." : "Run another discovery within a new approval, or broaden the request." };
  }
  if (i.pending > 0) {
    return { ...base, status: "needs_verification", shortfall,
      summary: `No company is qualified yet: ${plural(i.pending, "candidate")} need verification${openText}.`,
      nextStep: "Verify the open requirement for these candidates, or change the request." };
  }
  return { ...base, status: "no_results", shortfall,
    summary: i.rejected ? `No company qualified: ${plural(i.rejected, "candidate")} ${i.rejected === 1 ? "was" : "were"} ruled out by your requirements.` : "No company matched the search.",
    nextStep: "Broaden the request, or try another discovery source." };
}
