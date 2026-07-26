// DETERMINISTIC VALIDATION of a proposed broadening round + prompt-injection
// defence. Nothing an AI returns reaches a provider without passing this.
//
// Provider output (job descriptions, company blurbs, profile headlines) is
// UNTRUSTED. It never enters the planner instruction section, and any planner
// output that looks like an instruction, a command, a secret or an unapproved URL
// is rejected outright and the deterministic fallback is used instead.

import type { RoundPlan, PlannerProposal } from "./broadeningPlan.ts";
import { plannerApprovedTitleUniverse } from "./broadeningPlan.ts";
import type { SourcingConstraints, HardConstraints } from "./sourcingConstraints.ts";
import { hashHardConstraints } from "./sourcingConstraints.ts";
import { validateTitleForFamily } from "./jobFamilyRegistry.ts";

export interface ValidationResult {
  ok: boolean;
  approvedTitles: string[];
  rejectedTitles: Array<{ title: string; reason: string }>;
  violations: string[];
}

const MAX_TITLE_LEN = 60;
const MAX_TITLES = 12;

/** Text patterns that must never appear in planner output. */
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bignore (?:all )?(?:previous|prior|above) instructions?\b/i, "instruction_override"],
  [/\bdisregard (?:the )?(?:policy|rules|constraints)\b/i, "instruction_override"],
  [/\b(?:drop|delete|truncate|insert into|update .* set|select .* from)\b/i, "sql"],
  [/(?:^|\s)(?:rm|curl|wget|bash|sh|chmod|sudo)\s+-?/i, "shell_command"],
  [/<script|javascript:|eval\(|process\.env|require\(/i, "executable_code"],
  [/\b(?:api[_ -]?key|secret|password|bearer|authorization|cookie)\b\s*[:=]/i, "credential"],
  [/https?:\/\//i, "url_not_allowed"],
  [/\b(?:increase|raise|set|change) (?:the )?(?:budget|cost|limit|quota)\b/i, "budget_tampering"],
  [/\b(?:every|all) (?:industry|industries|geograph|countr)/i, "constraint_tampering"],
];

export function detectInjection(text: string): string | null {
  for (const [re, label] of INJECTION_PATTERNS) if (re.test(text)) return label;
  return null;
}

/** Scan an entire planner proposal, including unexpected extra fields. */
export function scanProposalForInjection(proposal: PlannerProposal): string | null {
  const blob = JSON.stringify(proposal ?? {});
  return detectInjection(blob);
}

/**
 * Validate a proposed round against the hard constraints and the family registry.
 * `proposedRound` is the plan the controller would execute; `baselineHard` is the
 * hard-constraint set the plan was created against.
 */
export async function validateRoundPlan(
  proposedRound: RoundPlan,
  constraints: SourcingConstraints,
  baselineHard: HardConstraints,
  attemptedStrategyHashes: string[],
): Promise<ValidationResult> {
  const violations: string[] = [];
  const approvedTitles: string[] = [];
  const rejectedTitles: Array<{ title: string; reason: string }> = [];

  // 1. Hard constraints must be byte-identical.
  if ((await hashHardConstraints(constraints.hard)) !== (await hashHardConstraints(baselineHard))) {
    violations.push("hard_constraints_changed");
  }

  // 2/3. Titles must belong to the requested (or explicitly approved adjacent) family.
  const universe = plannerApprovedTitleUniverse(constraints.hard, constraints.soft).map((t) => t.toLowerCase());
  for (const raw of proposedRound.title_queries ?? []) {
    const title = String(raw ?? "").trim();
    if (!title || title.length > MAX_TITLE_LEN) { rejectedTitles.push({ title, reason: "invalid_or_too_long" }); continue; }
    const inj = detectInjection(title);
    if (inj) { rejectedTitles.push({ title, reason: `injection:${inj}` }); continue; }
    // The literal requested titles are always allowed.
    if (constraints.hard.requestedTitles.some((r) => r.toLowerCase() === title.toLowerCase())) { approvedTitles.push(title); continue; }
    const v = validateTitleForFamily(constraints.hard.jobFamilyKey, title);
    if (v.verdict !== "approved") { rejectedTitles.push({ title, reason: v.reason }); continue; }
    if (!universe.includes(title.toLowerCase())) { rejectedTitles.push({ title, reason: "not_in_approved_universe" }); continue; }
    approvedTitles.push(title);
  }
  if (approvedTitles.length === 0) violations.push("no_approved_titles");
  if (approvedTitles.length > MAX_TITLES) violations.push("too_many_titles");

  // 4. Geography / vertical / roles / gates are hard — a round may not carry changes.
  for (const change of proposedRound.proposed_changes ?? []) {
    if (/geograph|location|country|vertical|industry|person_role|employer|evidence|gate|budget|cost/i.test(change)) {
      violations.push(`forbidden_change:${change}`);
    }
  }

  // 5. Only approved actors.
  for (const k of proposedRound.approved_actor_keys ?? []) {
    if (!constraints.soft.approvedActorKeys.includes(k)) violations.push(`unapproved_actor:${k}`);
  }

  // 6. Limits stay bounded by the soft constraints (planner cannot inflate them).
  if (proposedRound.raw_job_limit > constraints.soft.maxRawJobs) violations.push("raw_job_limit_exceeded");
  if (proposedRound.people_per_company > constraints.soft.peoplePerCompany) violations.push("people_per_company_exceeded");
  if (proposedRound.company_selection_limit > constraints.soft.maxCompanies + 10) violations.push("company_limit_unsafe");
  if (proposedRound.people_lookup_limit > constraints.soft.maxPeopleLookups + 10) violations.push("people_limit_unsafe");

  // 7. Never repeat an already-attempted strategy.
  if (proposedRound.strategy_hash && attemptedStrategyHashes.includes(proposedRound.strategy_hash)) {
    violations.push("duplicate_strategy");
  }

  // 8. The raw user sentence must never become a provider keyword.
  for (const t of approvedTitles) {
    if (t.split(/\s+/).length > 6) violations.push("raw_query_leak");
  }

  return { ok: violations.length === 0 && approvedTitles.length > 0, approvedTitles, rejectedTitles, violations };
}
