// GPT DECIDES HOW TO BROADEN. CODE DECIDES WHETHER IT MAY.
//
// The planner is asked one question after a round falls short: what would make
// the NEXT round find better opportunities? It is good at that — it knows that
// "Sales Operations" is next to "Revenue Operations", and that a PLC integrator
// is next to a SCADA integrator, without anyone writing a broadening table for
// every industry in advance.
//
// It is not allowed to decide anything else. Not the Actor, not the input, not
// the budget, not the deadline, and above all not whether people get bought.
//
// WHAT THE PLANNER NEVER SEES: an Actor id, a provider name, a credential, a
// raw provider input, a founder, or a contact detail. If it cannot read a
// vendor name it cannot ask for one, which is the same containment property the
// mission compiler and the grounded Brain already rely on.
//
// WHAT IT CANNOT DO EVEN IF IT ASKS: cross a hard mission constraint. Geography
// and business model are checked against `allowed_broadening` rather than
// against the planner's own confidence, because a persuasive `reason` string is
// exactly what a silent broadening looks like from the inside.
//
// PURE. No network, no provider, no model, no database.

import {
  isPublicCapability, PUBLIC_CAPABILITY_IDS, PEOPLE_STAGE_CAPABILITIES,
  PUBLIC_CAPABILITY_CATALOGUE,
} from "./leadCapabilityCatalogue.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import {
  conceptHash, isConceptExhausted, strategyForRound,
  type MultiRoundState, type RoundStrategyType,
} from "./multiRoundState.ts";

export const ROUND_PLAN_VERSION = "round-plan-v1" as const;

/**
 * Capabilities a ROUND may ever contain.
 *
 * Derived by SUBTRACTION from the public catalogue: everything except the
 * people stages and the two offers. Stated this way so a capability added to
 * the catalogue later is available to rounds automatically, while a people
 * stage added later is excluded automatically — the failure direction that
 * matters.
 */
export const ROUND_ELIGIBLE_CAPABILITIES: readonly string[] =
  PUBLIC_CAPABILITY_IDS.filter((c) =>
    !(PEOPLE_STAGE_CAPABILITIES as readonly string[]).includes(c) &&
    c !== "offer_founder_unlock" && c !== "offer_contact_unlock");

/**
 * Names a search concept may never contain.
 *
 * Two separate risks. The provider names stop the planner from reaching around
 * the capability catalogue to request an Actor by name. The URL/credential
 * patterns stop a concept from becoming an instruction — "scrape
 * https://…?key=…" is not a search concept, it is a command.
 */
const FORBIDDEN_IN_CONCEPT =
  /(https?:\/\/|www\.|\bapify\b|\bharvestapi\b|\bmemo23\b|\bsolidcode\b|\bcrawlworks\b|\bactor\b|\bscraper?\b|\bscrape\b|\bcrawl\b|\bapi[_ -]?key\b|\btoken\b|\bbearer\b|\bdataset\b|\bendpoint\b)/i;

export type RoundPlanRejection =
  | "unreadable_plan"
  | "unknown_capability"
  | "people_capability_refused"
  | "prohibited_capability"
  | "unsafe_search_concept"
  | "geography_broadening_not_permitted"
  | "company_type_broadening_not_permitted"
  | "employee_range_broadening_not_permitted"
  | "exclusion_removal_refused"
  | "disallowed_broadening_requested"
  | "no_actionable_change";

export interface RoundPlanRejectionEntry {
  reason: RoundPlanRejection;
  detail: string;
  /** The offending value, kept for the audit trail. */
  value?: string;
}

// ─────────────────────────────────────────────────── the planner's input ──

export const ROUND_PLANNER_PROMPT = [
  "A sourcing round has finished and has not yet found enough opportunities.",
  "Decide whether ANOTHER round is worth running, and if so, how it should",
  "search differently.",
  "You may propose: additional abstract capabilities, new search concepts,",
  "broader or narrower commercial signals, adjacent company types, and an",
  "adjusted employee range.",
  "You may propose ONLY broadening the mission explicitly permits. Never widen",
  "geography, business model or an exclusion that the mission did not allow.",
  "Never name a data provider, a tool, an Actor, a URL or a credential.",
  "Never ask for people, founders, decision-makers or contact details; those are",
  "bought separately by the user and are not yours to request.",
  "Say continue=false when another round is unlikely to produce genuinely",
  "relevant opportunities. Falling short of the requested number is NOT by",
  "itself a reason to continue — padding a list with weak companies is worse",
  "than reporting an honest shortfall.",
  "Return only the requested JSON object.",
].join(" ");

/**
 * What the planner is given.
 *
 * Deliberately assembled here rather than passed through from the caller, so
 * there is one place to check that no Actor, provider or person is in it.
 */
export function buildRoundPlannerPayload(i: {
  mission: LeadMissionV1;
  state: MultiRoundState;
  /** Coarse classes, never raw budget figures the planner might optimise against. */
  remainingBudgetClass: "ample" | "limited" | "exhausted";
  remainingDeadlineClass: "ample" | "limited" | "reserve_reached";
  rejectionReasons?: string[];
  missingEvidencePatterns?: string[];
  discoverySourceCoverage?: string[];
}): Record<string, unknown> {
  const d = i.mission.directives;
  return {
    schema_version: ROUND_PLAN_VERSION,
    instruction: ROUND_PLANNER_PROMPT,
    mission: {
      original_user_query: i.mission.original_user_query,
      requested_opportunity_count: i.state.requested_opportunity_count,
      business_models: i.mission.company_profile.business_models,
      verticals: i.mission.company_profile.verticals,
      locations: i.mission.company_profile.locations,
      employee_range: i.mission.company_profile.employee_range ?? null,
      required_signals: i.mission.required_signals.map((s) => ({
        type: s.type, role_families: s.role_families ?? [],
      })),
    },
    progress: {
      round_number: i.state.round_number,
      max_rounds: i.state.max_rounds,
      next_round_strategy: strategyForRound(i.state.round_number + 1),
      delivered: i.state.delivered_opportunity_count,
      shortfall: i.state.remaining_shortfall,
      qualified: i.state.qualified_count,
      review: i.state.review_count,
      watch: i.state.watch_count,
      unique_companies_seen: i.state.unique_company_count,
      eligible: i.state.eligible_company_count,
      evaluated: i.state.evaluated_company_count,
    },
    // WHY THE POOL LOOKS LIKE THIS, so the planner proposes a fix rather than a
    // repeat. Reasons are free text produced by earlier deterministic stages;
    // they carry no company identity and no provider name.
    diagnostics: {
      rejection_reasons: i.rejectionReasons ?? [],
      missing_evidence_patterns: i.missingEvidencePatterns ?? [],
      discovery_source_coverage: i.discoverySourceCoverage ?? [],
    },
    round_history: i.state.round_history.map((r) => ({
      round: r.round,
      strategy_type: r.strategy_type,
      search_concepts: r.search_concepts,
      signal_families: r.signal_families,
      company_types: r.company_types,
      discovered: r.discovered,
      new_companies: r.new_companies,
      eligible: r.eligible,
      delivered: r.new_delivered_opportunities,
    })),
    // ALREADY TRIED AND SPENT. Handing these over is what stops the planner
    // rewording an exhausted concept and buying the same rows again.
    exhausted_search_concepts: i.state.exhausted_search_concepts,
    exhausted_capabilities: i.state.exhausted_capabilities,
    allowed_broadening: d?.allowed_broadening ?? {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: d?.disallowed_broadening ?? [],
    excluded_signals: d?.excluded_signals ?? [],
    // ABSTRACT NAMES ONLY. There is no field here in which an Actor could be
    // named, because the vocabulary itself contains no vendor.
    available_capabilities: ROUND_ELIGIBLE_CAPABILITIES,
    budget: {
      remaining_budget_class: i.remainingBudgetClass,
      remaining_deadline_class: i.remainingDeadlineClass,
    },
    response_schema: {
      continue: "boolean",
      reason: "string",
      expected_incremental_value: "high | medium | low",
      additional_capabilities: ["string"],
      new_search_concepts: ["string"],
      signal_broadening: { add: ["string"], keep: ["string"], exclude: ["string"] },
      company_type_broadening: { add: ["string"], reason: "string | null" },
      employee_range_adjustment: {
        min: "number | null", max: "number | null", reason: "string | null",
      },
      source_strategy_adjustment: ["string"],
      stop_reason: "string | null",
    },
  };
}

// ────────────────────────────────────────────────── the planner's output ──

export interface RoundPlanProposal {
  continue: boolean;
  reason: string;
  expected_incremental_value: "high" | "medium" | "low";
  additional_capabilities: string[];
  new_search_concepts: string[];
  signal_broadening: { add: string[]; keep: string[]; exclude: string[] };
  company_type_broadening: { add: string[]; reason: string | null };
  employee_range_adjustment: {
    min: number | null; max: number | null; reason: string | null;
  };
  source_strategy_adjustment: string[];
  stop_reason: string | null;
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((x) => x.trim()) : [];
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Read the planner's answer.
 *
 * A MALFORMED PLAN IS A STOP, NOT A GUESS. Returning null here means the
 * controller ends the run honestly rather than executing a half-understood
 * broadening — the failure direction that costs nothing.
 */
export function parseRoundPlan(raw: unknown): RoundPlanProposal | null {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.continue !== "boolean") return null;

  const sb = (r.signal_broadening ?? {}) as Record<string, unknown>;
  const ct = (r.company_type_broadening ?? {}) as Record<string, unknown>;
  const er = (r.employee_range_adjustment ?? {}) as Record<string, unknown>;
  const value = String(r.expected_incremental_value ?? "").toLowerCase();

  return {
    continue: r.continue,
    reason: String(r.reason ?? "").slice(0, 600),
    expected_incremental_value:
      value === "high" || value === "medium" ? value : "low",
    additional_capabilities: arr(r.additional_capabilities),
    new_search_concepts: arr(r.new_search_concepts),
    signal_broadening: {
      add: arr(sb.add), keep: arr(sb.keep), exclude: arr(sb.exclude),
    },
    company_type_broadening: {
      add: arr(ct.add),
      reason: typeof ct.reason === "string" ? ct.reason.slice(0, 300) : null,
    },
    employee_range_adjustment: {
      min: num(er.min), max: num(er.max),
      reason: typeof er.reason === "string" ? er.reason.slice(0, 300) : null,
    },
    source_strategy_adjustment: arr(r.source_strategy_adjustment),
    stop_reason: typeof r.stop_reason === "string" ? r.stop_reason.slice(0, 300) : null,
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ────────────────────────────────────────────────────── validation ──

export interface ValidatedRoundPlan {
  round: number;
  strategy_type: RoundStrategyType;
  capabilities: string[];
  search_concepts: string[];
  signal_families: string[];
  company_types: string[];
  employee_range: { min: number | null; max: number | null };
  expected_incremental_value: "high" | "medium" | "low";
  reason: string;
  /** Everything code removed, and why. Persisted for audit. */
  rejections: RoundPlanRejectionEntry[];
}

export type RoundPlanValidation =
  | { ok: true; plan: ValidatedRoundPlan }
  | { ok: false; rejections: RoundPlanRejectionEntry[]; stop_detail: string };

const lower = (s: string) => s.toLowerCase().trim();

/**
 * Validate a proposal against the mission's HARD constraints.
 *
 * The design rule this enforces: broadening is permitted only where the
 * accepted mission said it was. `allowed_broadening` is not advice — an empty
 * `geographies` list means geography is fixed, and a planner asking to add
 * Canada to a United States mission is refused no matter how good its reason is.
 *
 * The people-capability check is separate from the unknown-capability check on
 * purpose. They fail for different reasons, and conflating them would let a
 * future catalogue change turn "refused because it buys people" into "accepted
 * because it is now a known capability".
 */
export function validateRoundPlan(i: {
  proposal: RoundPlanProposal;
  mission: LeadMissionV1;
  state: MultiRoundState;
}): RoundPlanValidation {
  const rejections: RoundPlanRejectionEntry[] = [];
  const round = i.state.round_number + 1;
  const d = i.mission.directives;
  const allowed = d?.allowed_broadening;
  const disallowed = (d?.disallowed_broadening ?? []).map(lower);
  const excluded = (d?.excluded_signals ?? []).map(lower);

  if (!i.proposal.continue) {
    return {
      ok: false, rejections,
      stop_detail: i.proposal.stop_reason || i.proposal.reason ||
        "the planner judged another round not worthwhile",
    };
  }

  // ── CAPABILITIES ────────────────────────────────────────────────────────
  const capabilities: string[] = [];
  for (const c of i.proposal.additional_capabilities) {
    // PEOPLE ARE NEVER A ROUND'S BUSINESS. Checked first and by its own name,
    // so this refusal can never be reclassified as an unknown-capability one.
    if ((PEOPLE_STAGE_CAPABILITIES as readonly string[]).includes(c) ||
      c === "offer_founder_unlock" || c === "offer_contact_unlock" ||
      /founder|contact|people|employee|profile/i.test(c)) {
      rejections.push({
        reason: "people_capability_refused", value: c,
        detail: "a sourcing round may never schedule people or contact discovery",
      });
      continue;
    }
    if (!isPublicCapability(c) || !ROUND_ELIGIBLE_CAPABILITIES.includes(c)) {
      rejections.push({
        reason: "unknown_capability", value: c,
        detail: "not an approved capability for a sourcing round",
      });
      continue;
    }
    if (i.mission.prohibited_capabilities.some((p) => String(p) === c)) {
      rejections.push({
        reason: "prohibited_capability", value: c,
        detail: "the mission prohibits this capability",
      });
      continue;
    }
    if (i.state.exhausted_capabilities.includes(c)) continue;
    capabilities.push(c);
  }

  // ── SEARCH CONCEPTS ─────────────────────────────────────────────────────
  const search_concepts: string[] = [];
  for (const c of i.proposal.new_search_concepts) {
    if (FORBIDDEN_IN_CONCEPT.test(c)) {
      rejections.push({
        reason: "unsafe_search_concept", value: c,
        detail: "a concept may not name a provider, tool, URL or credential",
      });
      continue;
    }
    if (c.length > 120) {
      rejections.push({
        reason: "unsafe_search_concept", value: c.slice(0, 60),
        detail: "a search concept this long is an instruction, not a concept",
      });
      continue;
    }
    // ALREADY BOUGHT. An exhausted concept reworded is the same concept.
    if (isConceptExhausted(c, i.state.exhausted_search_concepts)) continue;
    if (search_concepts.some((x) => conceptHash(x) === conceptHash(c))) continue;
    search_concepts.push(c);
  }

  // ── SIGNALS ─────────────────────────────────────────────────────────────
  const roleFamilies = (allowed?.role_families ?? []).map(lower);
  const signal_families: string[] = [];
  for (const s of [...i.proposal.signal_broadening.keep, ...i.proposal.signal_broadening.add]) {
    // AN EXCLUDED SIGNAL STAYS EXCLUDED. The planner may not re-add what the
    // mission removed, whatever it calls it.
    if (excluded.includes(lower(s))) {
      rejections.push({
        reason: "exclusion_removal_refused", value: s,
        detail: "the mission excluded this signal",
      });
      continue;
    }
    if (disallowed.includes(lower(s))) {
      rejections.push({
        reason: "disallowed_broadening_requested", value: s,
        detail: "the mission disallowed this broadening",
      });
      continue;
    }
    const isNew = i.proposal.signal_broadening.add.includes(s);
    // A NEW role family must be one the mission permitted. Keeping an existing
    // one needs no permission — it is not broadening.
    if (isNew && roleFamilies.length > 0 && !roleFamilies.includes(lower(s))) {
      rejections.push({
        reason: "disallowed_broadening_requested", value: s,
        detail: "not in the mission's allowed role families",
      });
      continue;
    }
    if (isNew && roleFamilies.length === 0) {
      rejections.push({
        reason: "disallowed_broadening_requested", value: s,
        detail: "the mission permits no role-family broadening",
      });
      continue;
    }
    if (!signal_families.includes(s)) signal_families.push(s);
  }

  // ── COMPANY TYPE — the business-model guard ─────────────────────────────
  const allowedTypes = (allowed?.company_types ?? []).map(lower);
  const company_types: string[] = [];
  for (const t of i.proposal.company_type_broadening.add) {
    if (disallowed.includes(lower(t))) {
      rejections.push({
        reason: "disallowed_broadening_requested", value: t,
        detail: "the mission disallowed this company type",
      });
      continue;
    }
    // A B2B SAAS MISSION DOES NOT QUIETLY BECOME A MISSION ABOUT AGENCIES.
    // Empty `company_types` means the business model is fixed.
    if (!allowedTypes.includes(lower(t))) {
      rejections.push({
        reason: "company_type_broadening_not_permitted", value: t,
        detail: allowedTypes.length === 0
          ? "the mission fixed the business model; no adjacent type is permitted"
          : "not among the mission's permitted adjacent company types",
      });
      continue;
    }
    company_types.push(t);
  }

  // ── GEOGRAPHY — never inferred, only permitted ──────────────────────────
  //
  // There is no geography field in the proposal on purpose: the only way a
  // round could change country is by smuggling it through a concept or a
  // company type, and both are checked above. This check catches the remaining
  // route — a source-strategy adjustment naming a region the mission fixed.
  const allowedGeos = (allowed?.geographies ?? []).map(lower);
  const missionGeos = i.mission.company_profile.locations.map(lower);
  for (const s of i.proposal.source_strategy_adjustment) {
    const hit = GEO_TOKENS.find((g) => new RegExp(`\\b${g}\\b`, "i").test(s));
    if (!hit) continue;
    if (missionGeos.some((m) => m.includes(hit)) || allowedGeos.some((a) => a.includes(hit))) {
      continue;
    }
    rejections.push({
      reason: "geography_broadening_not_permitted", value: s,
      detail: `"${hit}" is outside the mission's geography and its permitted broadening`,
    });
  }

  // ── EMPLOYEE RANGE ──────────────────────────────────────────────────────
  const range = resolveEmployeeRange(i.proposal, i.mission, rejections);

  // ── DID ANY OF IT SURVIVE? ──────────────────────────────────────────────
  //
  // A plan whose every element was refused is not a narrower plan, it is no
  // plan. Running the round anyway would repeat the previous one at full price.
  const actionable = capabilities.length + search_concepts.length +
    company_types.length + signal_families.length +
    (range.min !== null || range.max !== null ? 1 : 0);
  if (actionable === 0) {
    return {
      ok: false,
      rejections: rejections.length > 0 ? rejections : [{
        reason: "no_actionable_change",
        detail: "the plan proposed nothing this mission permits",
      }],
      stop_detail: "no permitted broadening survived validation",
    };
  }

  return {
    ok: true,
    plan: {
      round,
      strategy_type: strategyForRound(round),
      capabilities, search_concepts, signal_families, company_types,
      employee_range: range,
      expected_incremental_value: i.proposal.expected_incremental_value,
      reason: i.proposal.reason,
      rejections,
    },
  };
}

/**
 * Turn a VALIDATED plan into the mission the next round actually runs.
 *
 * This is the only place a round's broadening becomes real, and it is
 * deliberately additive: role families and company types are appended, never
 * substituted, so round 2 still finds everything round 1 was looking for.
 *
 * THREE FIELDS ARE COPIED THROUGH UNTOUCHED AND ON PURPOSE — `locations`,
 * `business_models` and the original query. Validation already refused any
 * proposal that tried to move them; carrying them by reference here means even
 * a validation bug cannot rewrite the country or the business model, because
 * there is no assignment to them in this function at all.
 */
export function applyRoundPlanToMission(
  mission: LeadMissionV1, plan: ValidatedRoundPlan,
): LeadMissionV1 {
  const verticals = [...new Set([
    ...mission.company_profile.verticals, ...plan.company_types,
  ])];
  const employee_range = plan.employee_range.min === null && plan.employee_range.max === null
    ? mission.company_profile.employee_range
    : {
      ...(plan.employee_range.min !== null ? { min: plan.employee_range.min } : {}),
      ...(plan.employee_range.max !== null ? { max: plan.employee_range.max } : {}),
    };

  // Broadened role families ride on the signals that already carry them, so a
  // round-2 hiring search looks for the adjacent titles as well as the exact
  // ones. A mission with no role-bearing signal gains none.
  const required_signals = mission.required_signals.map((s) =>
    plan.signal_families.length > 0 && s.role_families
      ? { ...s, role_families: [...new Set([...s.role_families, ...plan.signal_families])] }
      : s);

  return {
    ...mission,
    company_profile: {
      ...mission.company_profile,
      // locations and business_models are NOT reassigned. See above.
      verticals,
      ...(employee_range ? { employee_range } : {}),
    },
    required_signals,
    // PUBLIC NAMES ARE TRANSLATED, NEVER PASSED THROUGH. `required_capabilities`
    // holds INTERNAL capability ids; writing a public name into it would create
    // a capability the graph cannot resolve — and, worse, one whose approved
    // Actors nobody checked. The catalogue owns that mapping.
    required_capabilities: [...new Set([
      ...mission.required_capabilities,
      ...plan.capabilities.flatMap((c) =>
        isPublicCapability(c) ? PUBLIC_CAPABILITY_CATALOGUE[c].internal : []),
    ])],
  };
}

/** Country/region words a source-strategy string must not silently introduce. */
const GEO_TOKENS = [
  "united states", "usa", "us", "canada", "canadian", "uk", "united kingdom",
  "europe", "european", "emea", "apac", "asia", "australia", "india", "germany",
  "france", "spain", "brazil", "latam", "mexico", "japan", "singapore",
];

function resolveEmployeeRange(
  p: RoundPlanProposal, mission: LeadMissionV1,
  rejections: RoundPlanRejectionEntry[],
): { min: number | null; max: number | null } {
  const proposed = p.employee_range_adjustment;
  if (proposed.min === null && proposed.max === null) return { min: null, max: null };

  const permitted = mission.directives?.allowed_broadening?.employee_range;
  // `Number(null) === 0` and is finite — a null bound must stay null rather
  // than becoming a 0 that every company fails against.
  const pMin = permitted?.min ?? null;
  const pMax = permitted?.max ?? null;
  if (pMin === null && pMax === null) {
    rejections.push({
      reason: "employee_range_broadening_not_permitted",
      detail: "the mission permits no employee-range broadening",
    });
    return { min: null, max: null };
  }

  // CLAMPED INTO THE PERMITTED WINDOW rather than refused outright: a planner
  // asking for 1–5000 inside a permitted 5–500 gets 5–500, which is the useful
  // reading of the request and cannot exceed what the mission allowed.
  const min = proposed.min === null ? pMin
    : pMin === null ? proposed.min : Math.max(pMin, proposed.min);
  const max = proposed.max === null ? pMax
    : pMax === null ? proposed.max : Math.min(pMax, proposed.max);
  if (min !== null && max !== null && min > max) {
    rejections.push({
      reason: "employee_range_broadening_not_permitted",
      detail: `proposed range inverts inside the permitted window (${min}..${max})`,
    });
    return { min: null, max: null };
  }
  return { min, max };
}
