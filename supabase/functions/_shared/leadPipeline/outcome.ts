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
// Only QUALIFIED companies count toward the requested number — plus, ONLY when the user
// permitted it, LIKELY matches (`likely`), which are always reported separately. Pure.

export type MissionOutcomeStatus =
  | "completed" | "completed_with_shortfall" | "needs_verification" | "no_results" | "blocked" | "failed" | "cancelled";

export interface MissionOutcome {
  status: MissionOutcomeStatus;
  requested: number | null;
  qualified: number;
  needsVerification: number;
  rejected: number;
  /** Likely matches counted with the user's permission (present only when there are any); never in `qualified`. */
  likely?: number;
  /** requested − (qualified + likely), when a number was requested and not met. */
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
  /** Likely matches the user permitted to count (acceptLikely); they are NOT in `pending`. */
  likely?: number;
  runStatus: "completed" | "partial" | "blocked" | "failed" | "cancelled";
  reason?: string | null;
  /** The REQUIRED requirements companies still lack evidence for (labels), for the next step. */
  openRequirements?: string[];
  spend?: { apifyUsd: number; leadoceanRecords: number; basis: "estimate" | "provider_reported" };
}): MissionOutcome {
  const spend = i.spend && (i.spend.apifyUsd > 0 || i.spend.leadoceanRecords > 0) ? i.spend : { apifyUsd: 0, leadoceanRecords: 0, basis: "none" as const };
  const likely = Math.max(0, i.likely ?? 0);
  // What counts toward the request: qualified, plus likely matches ONLY when permitted (likely > 0).
  const counted = i.qualified + likely;
  const base = { requested: i.requested, qualified: i.qualified, needsVerification: i.pending, rejected: i.rejected, ...(likely ? { likely } : {}), spend };
  const open = (i.openRequirements ?? []).filter(Boolean);
  const openText = open.length ? ` on ${open.join(", ")}` : "";
  // The words for what counted: unchanged without likely matches; split when there are any.
  const what = (n: number) => likely
    ? `${plural(n, "company", "companies")} matched (${i.qualified} verified, ${likely} likely B2B — not verified)`
    : `${plural(n, "company", "companies")} qualified`;
  if (i.runStatus === "blocked") return { ...base, status: "blocked", shortfall: null, summary: `Nothing was run: ${i.reason ?? "the plan was blocked"}.`, nextStep: "Answer the questions on the plan, then plan again." };
  if (i.runStatus === "cancelled") return { ...base, status: "cancelled", shortfall: i.requested !== null ? Math.max(0, i.requested - counted) : null, summary: `Cancelled: ${what(counted)} before the stop.`, nextStep: null };
  if (i.runStatus === "failed") return { ...base, status: "failed", shortfall: i.requested !== null ? Math.max(0, i.requested - counted) : null, summary: `The run stopped on an error${i.reason ? `: ${i.reason}` : ""}.`, nextStep: "Nothing is retried automatically. Review the error, then plan a new run." };
  const shortfall = i.requested !== null && counted < i.requested ? i.requested - counted : null;
  if (i.requested !== null ? counted >= i.requested : counted > 0) {
    return { ...base, status: "completed", shortfall: null, summary: `${what(counted)}${i.requested !== null ? ` of ${i.requested} requested` : ""}.`, nextStep: null };
  }
  if (counted > 0) {
    return { ...base, status: "completed_with_shortfall", shortfall,
      summary: `Only ${what(counted)} of ${i.requested} requested${i.pending ? `; ${i.pending} still need verification${openText}` : ""}.`,
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
