// actorBroadeningPlanner: decide IF and HOW to broaden the next attempt when
// accepted_count < requested_count. Deterministic guardrails are AUTHORITATIVE
// (never violate strict location/industry/stage, never switch actor, never
// exceed count cap). Gemini may PROPOSE better terms, but proposals are filtered
// through guardBroadenedTerms before use. This complements the existing
// runAdaptiveSourcing loop (which already broadens role→industry→stage→location)
// by exposing the per-step decision + the user-permission case for the UI.

import { buildAttemptStrategy, type SourcingCriteria, type StrictConstraints, type AttemptStrategy } from "./sourcingRetry.ts";
import { roleAliases, industrySynonyms } from "./broaden.ts";

export type BroadeningPlan = {
  next_attempt_allowed: boolean;
  reason: string;
  broadening_level: 1 | 2 | 3 | 4;
  changed_fields: string[];
  preserved_strict_fields: string[];
  next_input_patch: Record<string, unknown>;
  user_permission_required: boolean;
};

function strictFields(strict: StrictConstraints): string[] {
  const f: string[] = [];
  if (strict.location) f.push("location");
  if (strict.industry) f.push("industry");
  if (strict.stage) f.push("stage");
  return f;
}

export function planBroadening(args: {
  accepted: number;
  requested: number;
  attempt: number; // the NEXT attempt number (e.g. 2 after attempt 1)
  criteria: SourcingCriteria;
  strict: StrictConstraints;
}): BroadeningPlan {
  const preserved = strictFields(args.strict);

  // Goal met → stop.
  if (args.accepted >= args.requested) {
    return { next_attempt_allowed: false, reason: "requested count met", broadening_level: 1, changed_fields: [], preserved_strict_fields: preserved, next_input_patch: {}, user_permission_required: false };
  }

  const strat: AttemptStrategy = buildAttemptStrategy(args.attempt, args.criteria, args.strict);
  const c = args.criteria;

  // Which broadening levers remain for THIS (next) attempt? Role aliases are
  // applied at attempt 2; industry synonyms at attempt 3; stage/location after.
  const canBroadenRole = args.attempt <= 2;
  const canBroadenIndustry = !!c.industry && !args.strict.industry && args.attempt <= 3;
  const canBroadenStage = !!c.stage && !args.strict.stage;
  const canBroadenLocation = !!c.location && !args.strict.location;
  const anyLever = canBroadenRole || canBroadenIndustry || canBroadenStage || canBroadenLocation;

  // Out of levers while still short, and at least one field is locked strict →
  // ask the user before relaxing a strict constraint.
  if (!anyLever && preserved.length > 0) {
    return {
      next_attempt_allowed: false,
      reason: `Cannot broaden further without relaxing strict ${preserved.join("/")}.`,
      broadening_level: Math.min(4, Math.max(1, args.attempt)) as 1 | 2 | 3 | 4,
      changed_fields: [],
      preserved_strict_fields: preserved,
      next_input_patch: {},
      user_permission_required: true,
    };
  }

  const changed: string[] = [];
  const patch: Record<string, unknown> = {};
  if (canBroadenRole && strat.role_keywords?.length) { changed.push("role_keywords"); patch.role_keywords = strat.role_keywords; }
  if (canBroadenIndustry) { changed.push("industry"); patch.role_keywords = strat.role_keywords; }
  if (canBroadenStage && strat.relax_stage) { changed.push("stage"); patch.relax_stage = true; }
  if (canBroadenLocation && strat.relax_location) { changed.push("location"); patch.relax_location = true; }

  const level = (args.attempt <= 2 ? 1 : args.attempt === 3 ? 2 : strat.relax_location ? 4 : 3) as 1 | 2 | 3 | 4;
  return {
    next_attempt_allowed: anyLever,
    reason: strat.strategy_label,
    broadening_level: level,
    changed_fields: changed,
    preserved_strict_fields: preserved,
    next_input_patch: patch,
    user_permission_required: false,
  };
}

/**
 * Filter Gemini-proposed broadening terms so they never violate strict fields.
 * Role aliasing is always allowed (same role, different words). Location/industry
 * synonyms are dropped when that field is strict.
 */
export function guardBroadenedTerms(
  proposed: { role_keywords?: string[]; industry_terms?: string[]; location_terms?: string[] },
  strict: StrictConstraints,
  base: { role?: string | null; industry?: string | null; location?: string | null },
): { role_keywords: string[]; industry_terms: string[]; location_terms: string[]; dropped: string[] } {
  const dropped: string[] = [];
  // Role aliases: always allowed, but intersect with known aliases to avoid drift
  // into unrelated roles (guardrail: "SDR → all sales" only if it's a real alias).
  const allowedRoleSet = new Set(roleAliases(base.role).map((s) => s.toLowerCase()));
  const role_keywords = (proposed.role_keywords ?? []).filter((r) => {
    if (allowedRoleSet.size === 0) return true; // no known aliases → trust (still role-only)
    const ok = allowedRoleSet.has(r.toLowerCase()) || (base.role ? r.toLowerCase().includes(base.role.toLowerCase()) : true);
    if (!ok) dropped.push(`role:${r}`);
    return ok;
  });

  let industry_terms: string[] = [];
  if (strict.industry) {
    (proposed.industry_terms ?? []).forEach((t) => dropped.push(`industry(strict):${t}`));
  } else {
    const allowed = new Set(industrySynonyms(base.industry).map((s) => s.toLowerCase()));
    industry_terms = (proposed.industry_terms ?? []).filter((t) => allowed.size === 0 || allowed.has(t.toLowerCase()) || (base.industry ? true : false));
  }

  let location_terms: string[] = [];
  if (strict.location) {
    (proposed.location_terms ?? []).forEach((t) => dropped.push(`location(strict):${t}`));
  } else {
    location_terms = proposed.location_terms ?? [];
  }

  return { role_keywords, industry_terms, location_terms, dropped };
}
