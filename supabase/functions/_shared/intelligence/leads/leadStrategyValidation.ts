// LEAD STRATEGY VALIDATION — the department-specific half.
//
// The shared validator (../strategyValidation.ts) already enforces policy and
// execution safety: instruction preservation, workspace identity, capability
// allow-list, budget, URLs, actor ids, credentials, injection, duplicate hashes.
// This module adds the ONE thing that is genuinely a Lead question:
//
//   Does this title still mean the role the user asked for?
//
// THE REGISTRY'S NEW ROLE. `jobFamilyRegistry` is no longer the only authority on
// what may be searched — Claude may propose titles it has never heard of. It
// becomes EVIDENCE:
//
//   * an `excluded` verdict is still absolute — those exclusions encode real
//     mis-sourcing incidents, and no planner confidence overrides them;
//   * an `approved` verdict is a fast path to autonomous execution;
//   * `not_in_family` is no longer a rejection by itself — it means "unknown",
//     and the claimed relationship then decides.
//
// THE RULE THAT MATTERS: a title may execute autonomously only when it is the
// SAME role under another name. Anything that is a DIFFERENT role — an adjacent
// function, another family's title — needs a human, because silently sourcing a
// different role is how a quota gets filled with the wrong people.
//
// PURE. No network, no provider calls, no model calls.

import { JOB_FAMILY_REGISTRY, validateTitleForFamily, approvedTitlesFor, getJobFamily } from "../../jobFamilyRegistry.ts";
import type { LeadInitialStrategy } from "./leadStrategy.ts";
import type { LeadSourcingMission } from "./leadMission.ts";
import { missionBaselineTitles } from "./leadMission.ts";

export type TitleDisposition =
  /** Execute without asking. */
  | "autonomous"
  /** A human must approve before this title is searched. */
  | "approval_required"
  /** Never search this title, whatever the planner claims. */
  | "rejected";

export interface TitleDecision {
  title: string;
  disposition: TitleDisposition;
  /** Why, in terms a reviewer can act on. */
  reason: string;
  /** Which evidence decided it. */
  basis: "explicit_user" | "registry_approved" | "registry_excluded" | "safe_synonym" | "other_family" | "unknown";
}

/** Minimum confidence before a claimed synonym may execute without a human. */
export const SYNONYM_CONFIDENCE_FLOOR = 0.7;

function norm(s: string): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Does this title belong to a DIFFERENT registry family?
 *
 * This is the guard that stops an adjacent function being smuggled in as a
 * "synonym". "Sales Manager" offered as a synonym for Sales Operations is a
 * different job; the registry already knows it belongs to sales leadership, and
 * that knowledge is exactly what makes the claim checkable.
 */
export function belongsToOtherFamily(familyKey: string | null | undefined, title: string): string | null {
  const t = norm(title);
  for (const [key, def] of Object.entries(JOB_FAMILY_REGISTRY)) {
    if (key === familyKey) continue;
    if (approvedTitlesFor(def).some((a) => norm(a) === t)) return key;
  }
  return null;
}

export interface DecideTitleInput {
  familyKey: string | null;
  /** Titles the user typed. Their own words are always allowed. */
  explicitTitles: string[];
  /** Exclusions from the mission's hard constraints. */
  excludedTitles: string[];
  title: string;
  /** What the planner claimed this title is. `adjacent` is never autonomous. */
  claim: "exact" | "safe_synonym" | "adjacent";
  confidence: number;
}

/**
 * Decide one title.
 *
 * Order is deliberate: exclusions are checked FIRST, before any allow rule, so no
 * combination of user wording and planner confidence can resurrect an excluded
 * title.
 */
export function decideTitle(input: DecideTitleInput): TitleDecision {
  const title = String(input.title ?? "").trim();
  const t = norm(title);

  if (!t) return { title, disposition: "rejected", reason: "empty title", basis: "unknown" };

  // 1. EXCLUSIONS ARE ABSOLUTE.
  if (input.excludedTitles.some((x) => norm(x) === t || t.includes(norm(x)))) {
    return { title, disposition: "rejected", reason: `"${title}" is an excluded title for this request`, basis: "registry_excluded" };
  }
  const verdict = validateTitleForFamily(input.familyKey, title);
  if (verdict.verdict === "excluded") {
    return { title, disposition: "rejected", reason: verdict.reason, basis: "registry_excluded" };
  }

  // 2. The user's own wording. Highest authority in the system.
  if (input.explicitTitles.some((x) => norm(x) === t)) {
    return { title, disposition: "autonomous", reason: "named by the user", basis: "explicit_user" };
  }

  // 3. The registry recognises it for THIS family — but WHICH list matters.
  //
  //    `approvedTitlesFor` deliberately returns exact + synonyms + ADJACENT,
  //    because it was written for the round-2 broadening path where adjacent roles
  //    are a legitimate widening. This is the INITIAL round. Taking that verdict at
  //    face value here would start round 1 already broadened into adjacent roles —
  //    exactly the silent expansion Phase 2 is required to prevent.
  //
  //    So the two lists are separated: same-role wording executes, adjacent roles
  //    are gated even though the registry knows and likes them.
  const def = getJobFamily(input.familyKey);
  if (def) {
    if (def.exact.some((x) => norm(x) === t) || def.synonyms.some((x) => norm(x) === t)) {
      return { title, disposition: "autonomous", reason: `"${title}" is a known ${def.label} title`, basis: "registry_approved" };
    }
    if (def.adjacent.some((x) => norm(x) === t)) {
      return {
        title, disposition: "approval_required",
        reason: `"${title}" is registered as ADJACENT to ${def.label} — allowed when broadening, not in the initial round`,
        basis: "other_family",
      };
    }
  }

  // 4. Known to belong to ANOTHER family ⇒ a different role, never autonomous.
  const other = belongsToOtherFamily(input.familyKey, title);
  if (other) {
    return {
      title, disposition: "approval_required",
      reason: `"${title}" belongs to the "${other}" family — a different role from the one requested`,
      basis: "other_family",
    };
  }

  // 5. Adjacent is adjacent, whatever the confidence.
  if (input.claim === "adjacent") {
    return { title, disposition: "approval_required", reason: `"${title}" is an adjacent role`, basis: "unknown" };
  }

  // 6. An unknown title claimed as the same role. Allowed autonomously only with
  //    real confidence — otherwise a human decides. The registry has no opinion
  //    here, which is precisely the case Phase 2 exists to handle.
  if (input.claim === "safe_synonym" || input.claim === "exact") {
    if (input.confidence >= SYNONYM_CONFIDENCE_FLOOR) {
      return {
        title, disposition: "autonomous",
        reason: `"${title}" proposed as the same role (confidence ${input.confidence.toFixed(2)})`,
        basis: "safe_synonym",
      };
    }
    return {
      title, disposition: "approval_required",
      reason: `"${title}" proposed as a synonym but confidence ${input.confidence.toFixed(2)} is below ${SYNONYM_CONFIDENCE_FLOOR}`,
      basis: "safe_synonym",
    };
  }

  return { title, disposition: "approval_required", reason: `"${title}" is unrecognised`, basis: "unknown" };
}

// ------------------------------------------------------------ the strategy ----

export interface LeadTitleReview {
  approved: string[];
  approvalRequired: TitleDecision[];
  rejected: TitleDecision[];
  decisions: TitleDecision[];
}

/** Review every title a strategy proposes, from all three ontology buckets. */
export function reviewStrategyTitles(
  mission: LeadSourcingMission,
  strategy: LeadInitialStrategy,
): LeadTitleReview {
  const familyKey = mission.hiring_role.canonical_family ?? null;
  const explicitTitles = mission.hiring_role.explicit_titles;
  const excludedTitles = [
    ...((mission.constraints.hard.excluded_titles as string[] | undefined) ?? []),
    ...strategy.role_ontology.excluded_titles,
  ];

  const seen = new Set<string>();
  const decisions: TitleDecision[] = [];

  const consider = (title: string, claim: DecideTitleInput["claim"], confidence: number) => {
    const key = norm(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    decisions.push(decideTitle({ familyKey, explicitTitles, excludedTitles, title, claim, confidence }));
  };

  for (const t of strategy.role_ontology.exact_titles) consider(t, "exact", 1);
  for (const s of strategy.role_ontology.safe_synonyms) consider(s.title, s.relationship === "exact" ? "exact" : "safe_synonym", s.confidence);
  for (const a of strategy.role_ontology.adjacent_titles) consider(a.title, "adjacent", a.confidence);
  // Titles that appear only inside a search still get reviewed — a title cannot
  // reach a provider by skipping the ontology.
  //
  // EXCEPT a decision-maker search. Its titles are the PERSON TO CONTACT
  // ("Founder", "CEO"), not the role being hired. Reviewing them against the
  // hiring role's family would reject every one of them as "not a Sales Operations
  // title" — which is true, and entirely beside the point. That conflation is the
  // Phase 0 defect, and it must not reappear inside the validator that exists to
  // keep the two apart. Decision-maker roles are checked by
  // `checkLeadPreservation` against `mission.decision_maker` instead.
  for (const s of strategy.searches) {
    if (s.purpose === "find_decision_makers") continue;
    for (const t of s.titles ?? []) consider(t, "safe_synonym", strategy.confidence);
  }

  return {
    approved: decisions.filter((d) => d.disposition === "autonomous").map((d) => d.title),
    approvalRequired: decisions.filter((d) => d.disposition === "approval_required"),
    rejected: decisions.filter((d) => d.disposition === "rejected"),
    decisions,
  };
}

// ------------------------------------------------------- preservation checks ---

export interface LeadPreservationViolation {
  code: string;
  message: string;
  severity: "block" | "approval_required";
}

/**
 * Check the strategy did not quietly redefine the request.
 *
 * Each of these is a way to "succeed" by changing the question: widen the
 * geography, drop the decision-maker, relax the employer requirement, move the
 * seniority bar. The shared validator covers count/entity/quota/budget; these are
 * the Lead-shaped ones.
 */
export function checkLeadPreservation(
  mission: LeadSourcingMission,
  strategy: LeadInitialStrategy,
): LeadPreservationViolation[] {
  const out: LeadPreservationViolation[] = [];
  const block = (code: string, message: string) => out.push({ code, message, severity: "block" as const });
  const approval = (code: string, message: string) => out.push({ code, message, severity: "approval_required" as const });

  // GEOGRAPHY. The user's own locations must survive, and new ones need approval.
  const required = mission.company_target.geography.explicit_raw_locations.map(norm);
  const normalizedRequired = mission.company_target.geography.normalized_locations.map(norm);
  const planned = new Set<string>();
  for (const s of strategy.searches) for (const l of s.locations ?? []) planned.add(norm(l));

  if (required.length > 0 && planned.size > 0) {
    const satisfied = (r: string) => planned.has(r)
      || [...planned].some((p) => p.includes(r) || r.includes(p));
    const missing = required.filter((r, i) => !satisfied(r) && !satisfied(normalizedRequired[i] ?? r));
    if (missing.length > 0) {
      block("lead_geography_dropped", `Required location(s) dropped: ${missing.join(", ")}.`);
    }
    const allowed = new Set([...required, ...normalizedRequired]);
    const added = [...planned].filter((p) => ![...allowed].some((a) => a.includes(p) || p.includes(a)));
    if (added.length > 0) {
      approval("geography_expansion", `Strategy adds location(s) the user did not name: ${added.join(", ")}.`);
    }
  }

  // DECISION MAKER. A request that named a person to contact must keep them.
  const dmRoles = mission.decision_maker.roles.map(norm);
  if (dmRoles.length > 0) {
    const dmSearch = strategy.searches.find((s) => s.purpose === "find_decision_makers");
    if (!dmSearch) {
      block("decision_maker_search_missing", "The request names a person to contact but the strategy plans no decision-maker search.");
    } else {
      const plannedRoles = (dmSearch.titles ?? []).map(norm);
      if (plannedRoles.length > 0) {
        const kept = dmRoles.some((r) => plannedRoles.some((p) => p.includes(r) || r.includes(p)));
        if (!kept) {
          block("decision_maker_roles_changed",
            `Decision-maker roles changed: requested ${mission.decision_maker.roles.join(", ")}, planned ${(dmSearch.titles ?? []).join(", ")}.`);
        }
      }
    }
  }

  // HIRING SENIORITY. The bar the user set for the JOB must not move — and it must
  // never inherit the decision-maker's seniority, which is the Phase 0 defect.
  const missionSeniority = mission.hiring_role.seniority.map(norm);
  const strategySeniority = strategy.role_ontology.seniority.map(norm);
  if (missionSeniority.length === 0 && strategySeniority.length > 0) {
    const dmSeniority = new Set(mission.decision_maker.seniority.map(norm));
    const contaminated = strategySeniority.filter((s) => dmSeniority.has(s));
    if (contaminated.length > 0) {
      block("hiring_seniority_contaminated",
        `Hiring-role seniority [${contaminated.join(", ")}] was taken from the decision-maker, who is a different person.`);
    } else {
      approval("seniority_change", `Strategy adds hiring seniority [${strategySeniority.join(", ")}] the request did not state.`);
    }
  } else if (missionSeniority.length > 0) {
    const dropped = missionSeniority.filter((s) => !strategySeniority.includes(s));
    if (dropped.length > 0 && strategySeniority.length > 0) {
      approval("seniority_change", `Strategy drops requested hiring seniority: ${dropped.join(", ")}.`);
    }
  }

  // COMPANY VERTICAL.
  const missionVerticals = mission.company_target.verticals.map(norm).filter(Boolean);
  if (missionVerticals.length > 0) {
    const planned = strategy.company_interpretation.verticals.map(norm).filter(Boolean);
    if (planned.length > 0 && !missionVerticals.some((v) => planned.some((p) => p.includes(v) || v.includes(p)))) {
      approval("company_vertical_change",
        `Strategy targets vertical(s) [${strategy.company_interpretation.verticals.join(", ")}] instead of [${mission.company_target.verticals.join(", ")}].`);
    }
  }

  // The strategy must actually plan the sourcing the request needs.
  if (!strategy.searches.some((s) => s.purpose === "discover_hiring_companies") && mission.signal.required) {
    block("hiring_discovery_missing", "The request requires a hiring signal but no discovery search is planned.");
  }

  return out;
}

/** Titles the deterministic registry would have used. The fallback baseline. */
export function registryFallbackTitles(mission: LeadSourcingMission): string[] {
  const baseline = missionBaselineTitles(mission);
  if (baseline.length > 0) return baseline;
  const def = getJobFamily(mission.hiring_role.canonical_family ?? null);
  return def ? [...def.exact] : [];
}
