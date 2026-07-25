// Early-sales-hire assessment (reusable, OPTIONAL dimension — never a hard gate
// for the SaaS regression). "confirmed" requires EXPLICIT language; small size /
// founder-led / one vacancy are contributing signals, never sufficient alone.

export type EarlySalesHireConfidence =
  | "confirmed" | "high" | "medium" | "low" | "insufficient_evidence" | "not_applicable";

export interface EarlySalesHireInput {
  jobTitle?: string | null;
  jobDescription?: string | null;
  reportsTo?: string | null;
  hasVpSalesOrCro?: boolean | null;
  commercialTeamSize?: number | null;
  founderLed?: boolean | null;
  employeeCount?: number | null;
}

export interface EarlySalesHireResult {
  confidence: EarlySalesHireConfidence;
  evidence: string[];
  /** True only when explicit first-hire language was found. */
  explicit: boolean;
}

const EXPLICIT_RE = /\b(first (?:dedicated )?(?:sales|commercial) (?:hire|hires|person|rep|representative|employee|leader)|first salesperson|build(?:ing)? (?:out )?(?:the|our|a) sales (?:function|team|department|org|motion|process)|establish(?:ing)? (?:the|our|a) (?:sales|commercial) (?:function|department|team|org)|create (?:the|our|a) sales (?:process|function|team) from scratch|stand(?:ing)? up (?:the|our) sales (?:function|team)|found(?:ing)? sales hire)\b/i;
const REPORTS_FOUNDER_RE = /\b(founder|co-?founder|owner|president|ceo)\b/i;
const FULL_CYCLE_RE = /\b(full[-\s]?cycle|end[-\s]?to[-\s]?end selling|own the (?:entire )?sales (?:cycle|process))\b/i;
const PIPELINE_FROM_SCRATCH_RE = /\b(build (?:the )?pipeline|pipeline from (?:scratch|zero)|create (?:the )?pipeline|generate pipeline)\b/i;

export function assessEarlySalesHire(input: EarlySalesHireInput): EarlySalesHireResult {
  const hay = [input.jobTitle, input.jobDescription].filter(Boolean).join("  ");
  const evidence: string[] = [];

  const explicit = EXPLICIT_RE.test(hay);
  if (explicit) evidence.push("explicit_first_hire_language");

  // A known VP Sales / CRO CONFLICTS with a first-hire claim.
  const vpConflict = input.hasVpSalesOrCro === true;
  if (vpConflict) evidence.push("conflict_existing_vp_sales_or_cro");

  // Contributing (never sufficient alone) signals.
  if (input.reportsTo && REPORTS_FOUNDER_RE.test(input.reportsTo)) evidence.push("reports_to_founder");
  if (FULL_CYCLE_RE.test(hay)) evidence.push("owns_full_cycle");
  if (PIPELINE_FROM_SCRATCH_RE.test(hay)) evidence.push("builds_pipeline");
  if (typeof input.commercialTeamSize === "number" && input.commercialTeamSize <= 2) evidence.push("very_small_commercial_team");
  if (input.hasVpSalesOrCro === false) evidence.push("no_vp_sales_or_cro");
  if (input.founderLed) evidence.push("founder_led");

  const contributing = evidence.filter((e) => !e.startsWith("explicit") && !e.startsWith("conflict")).length;

  // Explicit + no conflict → confirmed. Explicit + VP conflict → downgrade (needs
  // resolution), never confirmed.
  if (explicit && !vpConflict) return { confidence: "confirmed", evidence, explicit };
  if (explicit && vpConflict) return { confidence: "high", evidence, explicit };

  // No explicit language: a known VP Sales/CRO means it is NOT an early hire.
  if (vpConflict) return { confidence: "low", evidence, explicit };

  if (contributing >= 3) return { confidence: "high", evidence, explicit };
  if (contributing === 2) return { confidence: "medium", evidence, explicit };
  if (contributing === 1) return { confidence: "low", evidence, explicit };
  return { confidence: "insufficient_evidence", evidence, explicit };
}
