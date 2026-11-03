// INTERPRETATION FUZZ — does the SAME requirement survive every field name a model might use?
//
//   deno run --allow-read --allow-env scripts/dev/interpretation-fuzz.ts            # compare with the recorded baseline
//   deno run --allow-read --allow-write --allow-env scripts/dev/interpretation-fuzz.ts --write
//
// Mission reliability S0 (root cause R1/R2). The proposal contract lets the model restate
// a requirement in `hard_constraints[]` under ANY field name. The live incidents were
// four such names (#203 hiring_activity, #211 hiring.role, #219 hiring_status, cf55180
// "signal role"). This compiles real requests with one requirement restated under many
// plausible spellings and classifies what reaches execution:
//
//   ok          the requirement is represented once, as the request means it
//   unmappable  an extra hard requirement no evidence can answer (P1 class)
//   dropped     the requirement is not represented at all
//   inverted    an exclusion became a requirement (or vice versa)
//
// Offline: the real compiler and planner spec, recorded model fields, no model call. The
// recorded baseline (tests/fixtures/mission-reliability/fuzz-baseline.json) is the number
// later stages must drive to zero; any change to it is a reviewed re-record.

import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { specFromMission } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";

const ROOT = new URL("../../", import.meta.url);
export const FUZZ_BASELINE_PATH = "tests/fixtures/mission-reliability/fuzz-baseline.json";

export type Outcome = "ok" | "unmappable" | "dropped" | "inverted";

const BLANK = {
  requested_opportunity_count: 5, requested_contact_ready_count: null, company_types: [], geographies: ["United States"], employee_range: { min: null, max: null },
  decision_maker_roles: [], soft_preferences: [], preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: 30, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: "companies", strategies: ["hiring"],
};
const US = { field: "geography", operator: "in", value: ["United States"], reason: "US" };

type Crit = { kind: string; dimension: string; value: unknown; geography_scope?: string };
const qualifier = (c: Crit | undefined) => ((c?.value as { qualifier?: Record<string, unknown> } | undefined)?.qualifier ?? {}) as
  { role_terms?: string[]; role_families?: string[]; excluded_role_terms?: string[] };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");

interface Category {
  id: string; query: string; proposal: Record<string, unknown>;
  value: unknown; operator: string; spellings: string[];
  /** Is the requirement represented as the request means it? */
  represented: (criteria: Crit[]) => boolean;
  inverted?: (criteria: Crit[]) => boolean;
}

export const CATEGORIES: Category[] = [
  {
    id: "role", query: "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range.",
    proposal: { company_types: ["B2B"], employee_range: { min: 20, max: 500 }, required_signal_terms: ["salespeople"] }, value: "salespeople", operator: "equals",
    spellings: ["hiring_role", "hiring.role", "hiring role", "hiringRole", "hiring_activity", "hiring_status", "hiring", "open_roles", "job_title", "job_titles",
      "signal role", "signal.role", "signal_role", "role", "roles", "target_role", "target_roles", "required_role", "role_requirement", "position", "positions",
      "open_position", "job_role", "hiring_for", "sales_role", "role_family", "job_function", "function", "signal_detail", "signal_qualifier"],
    represented: (cs) => cs.some((c) => c.kind === "hard" && c.dimension === "hiring" && (qualifier(c).role_families ?? []).includes("gtm_sales")),
  },
  {
    id: "size_preference", query: "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range.",
    proposal: { company_types: ["B2B"], employee_range: { min: 20, max: 500 }, required_signal_terms: ["salespeople"] }, value: { min: 20, max: 500 }, operator: "between",
    spellings: ["employee_range", "company_size", "headcount", "size", "employees", "employee_count", "team_size", "company_headcount", "staff_count", "number_of_employees"],
    // Hedged ("Prefer … but include outside"): a preference, never hard.
    represented: (cs) => cs.some((c) => c.kind !== "hard" && (c.dimension === "company_size" || JSON.stringify(c.value).includes("employee"))) &&
      !cs.some((c) => c.kind === "hard" && (c.dimension === "company_size" || JSON.stringify(c.value).includes("employee"))),
  },
  {
    id: "geography", query: "Find 5 US companies actively hiring Account Executives.",
    proposal: { required_signal_terms: ["Account Executive"] }, value: ["United States"], operator: "in",
    spellings: ["geography", "location", "country", "hq", "headquarters", "hq_country", "region", "company_location", "based_in", "market"],
    represented: (cs) => cs.filter((c) => c.kind === "hard" && c.dimension === "geography").length === 1,
  },
  {
    id: "industry", query: "Find 5 US fintech companies actively hiring Account Executives.",
    proposal: { company_types: ["fintech"], required_signal_terms: ["Account Executive"] }, value: "fintech", operator: "equals",
    spellings: ["industry", "industries", "vertical", "sector", "company_type", "market_segment", "business_type", "category", "niche", "domain"],
    represented: (cs) => cs.some((c) => c.kind === "hard" && c.dimension === "industry" && /fintech/i.test(String(c.value))),
  },
  {
    id: "role_exclusion", query: "Find 5 US companies actively hiring Account Executives but not SDRs.",
    proposal: { preferred_signals: ["hiring Account Executives but not SDRs"] }, value: "SDRs", operator: "excludes",
    spellings: ["excluded_roles", "exclude_roles", "excluded_role_terms", "role_exclusions", "excluded_titles", "not_roles", "exclude", "excluded", "roles_to_exclude", "negative_roles"],
    represented: (cs) => cs.some((c) => c.kind === "hard" && c.dimension === "hiring" && (qualifier(c).excluded_role_terms ?? []).some((t) => norm(t) === "sdr")),
    inverted: (cs) => cs.some((c) => c.kind === "hard" && c.dimension === "hiring" && (qualifier(c).role_terms ?? []).some((t) => norm(t) === "sdr")),
  },
  {
    id: "hiring_window", query: "Find 5 US companies hiring Account Executives in the last 30 days.",
    proposal: { required_signal_terms: ["Account Executive"] }, value: 30, operator: "within_days",
    spellings: ["hiring_window", "hiring_signal_recency", "posting_recency", "recency", "within_days", "posted_within", "timeframe", "time_window", "freshness", "signal_recency_days"],
    represented: (cs) => cs.some((c) => c.kind === "hard" && c.dimension === "hiring" && (c as { time_window?: { days?: number } }).time_window?.days === 30),
  },
];

export interface FuzzResult { category: string; spelling: string; outcome: Outcome; hard: string[] }

export function fuzz(): FuzzResult[] {
  const out: FuzzResult[] = [];
  for (const cat of CATEGORIES) {
    for (const field of cat.spellings) {
      const proposal = { ...BLANK, ...cat.proposal, hard_constraints: [US, { field, operator: cat.operator, value: cat.value, reason: "stated" }] };
      const m = compileLeadMission({ originalUserQuery: cat.query, proposal: proposal as never, requestedCount: 5 }).final_mission as unknown as Record<string, unknown>;
      const criteria = (m.criteria ?? []) as Crit[];
      const hard = specFromMission(m as never, { defaultCount: 5 }).requirements.hard.map((h) => h.key);
      const outcome: Outcome = cat.inverted?.(criteria) ? "inverted"
        : hard.includes("unmappable") ? "unmappable"
        : !cat.represented(criteria) ? "dropped" : "ok";
      out.push({ category: cat.id, spelling: field, outcome, hard });
    }
  }
  return out;
}

export function summarise(r: FuzzResult[]) {
  const by: Record<string, Record<Outcome, number>> = {};
  for (const x of r) {
    by[x.category] ??= { ok: 0, unmappable: 0, dropped: 0, inverted: 0 };
    by[x.category][x.outcome]++;
  }
  const failing = r.filter((x) => x.outcome !== "ok").length;
  return { cases: r.length, failing, by };
}

if (import.meta.main) {
  const r = fuzz();
  const s = summarise(r);
  if (Deno.args.includes("--write")) {
    await Deno.writeTextFile(new URL(FUZZ_BASELINE_PATH, ROOT), JSON.stringify({ summary: s, results: r.map(({ category, spelling, outcome }) => ({ category, spelling, outcome })) }, null, 1) + "\n");
    console.log(`wrote ${FUZZ_BASELINE_PATH}`, JSON.stringify(s));
  } else {
    console.log(JSON.stringify(s, null, 1));
    for (const x of r.filter((y) => y.outcome !== "ok")) console.log(`${x.outcome.padEnd(10)} ${x.category.padEnd(15)} ${x.spelling}`);
  }
}
