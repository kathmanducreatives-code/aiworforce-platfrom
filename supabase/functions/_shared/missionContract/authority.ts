// THE VERSION BOUNDARY BETWEEN THE TWO INTERPRETERS.
//
// A mission carrying a Mission Contract (`mission_contract`, v4) has ONE semantic
// authority: its approved contract. Every execution-time component that would otherwise
// re-read the user's sentence, re-merge the Company Brain or re-derive requirements from
// carrier fields asks `interpretationAuthority` first and, for "contract", reads the
// contract instead. A mission without one (v1 / v3 / stored history) keeps its legacy
// behaviour exactly: `legacy`.
//
// The two never compete: a component either reads the contract or the legacy path, never
// both, and the choice is made by the mission's own version, never by a flag at run time.
// Pure.

import type { MissionContract, Requirement } from "./contract.ts";

export type InterpretationAuthority = "contract" | "legacy";

export function interpretationAuthority(mission: unknown): InterpretationAuthority {
  const c = (mission as { mission_contract?: { version?: unknown } } | null)?.mission_contract;
  return c && typeof c === "object" && c.version === "mission-contract-v1" ? "contract" : "legacy";
}

export const contractOf = (mission: unknown): MissionContract | null =>
  interpretationAuthority(mission) === "contract" ? (mission as { mission_contract: MissionContract }).mission_contract : null;

/**
 * The Company Brain's REJECTING fields for the capability engine, under contract authority.
 *
 * The Brain was applied to the contract before approval (missionContract/brain.ts): its
 * size rule is a company_size requirement the mission already enforces, its industry
 * exclusions are `exclusion` requirements. So at run time the Brain contributes NOTHING
 * the user did not approve: no separate size rule (`employee_*`, `hard_constraints`
 * empty → the mission's own bounds apply), no disqualifier keywords, and exclusions only as
 * the contract states them. Preferences (business models, buyer roles, target signals)
 * stay ranking context and are supplied by the caller unchanged.
 */
export function runtimeBrainGatesFromContract(contract: MissionContract) {
  const industries = contract.requirements.filter((r): r is Extract<Requirement, { dimension: "industry" }> =>
    r.dimension === "industry" && r.polarity === "include").map((r) => r.value);
  const excluded = contract.requirements.filter((r): r is Extract<Requirement, { dimension: "exclusion" }> =>
    r.dimension === "exclusion" && r.field === "excluded_company_types" && r.necessity === "required")
    .flatMap((r) => (Array.isArray(r.values) ? r.values : [r.values])).map(String);
  return {
    employee_min: null, employee_max: null,
    positive_industries: [...new Set(industries)],
    excluded_industries: [...new Set(excluded)],
    required_geography: null,
    disqualifier_keywords: [] as string[],
    hard_constraints: [] as string[],
  };
}

/**
 * The text an execution-time reader may consult under contract authority: built ONLY from
 * the approved contract's include requirements (industries, places, hiring roles, signal
 * kinds, stages), never from the user's sentence. Exclusions are carried structurally by
 * the contract and are deliberately not written here (a negated word in free text is how
 * a reader turns "not SDRs" into SDRs).
 */
export function contractQueryText(c: MissionContract): string {
  const parts: string[] = [];
  const inc = c.requirements.filter((r) => !(r.dimension === "unsupported"));
  const industries = inc.filter((r): r is Extract<Requirement, { dimension: "industry" }> => r.dimension === "industry" && r.polarity === "include").map((r) => r.value);
  if (industries.length) parts.push(`${industries.join(" ")} companies`);
  for (const r of inc) {
    if (r.dimension !== "signal") continue;
    const roles = r.roleTerms?.length ? r.roleTerms.join(", ") : (r.roleFamilies ?? []).join(", ");
    parts.push(r.kind === "hiring" ? `hiring ${roles}`.trim() : r.kind.replace(/_/g, " "));
  }
  const places = inc.filter((r): r is Extract<Requirement, { dimension: "geography" }> => r.dimension === "geography" && r.polarity === "include").map((r) => r.place);
  if (places.length) parts.push(`in ${places.join(" or ")}`);
  for (const r of inc) if (r.dimension === "company_stage") parts.push(`${typeof r.stage === "string" ? r.stage : JSON.stringify(r.stage)} stage`);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** What an execution-time reader may read as "the request": the contract's text, or (legacy) the sentence. */
export function executionQueryOf(mission: { original_user_query?: unknown }): string {
  const c = contractOf(mission);
  return c ? contractQueryText(c) : String(mission.original_user_query ?? "");
}
