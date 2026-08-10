// DETERMINISTIC VALIDATOR for the unified lead strategy.
//
// The model PROPOSES. This module DISPOSES. Nothing a model returns reaches a
// paid provider call until it has survived every check here, and every check is
// pure, synchronous and unit-tested.

import {
  getRoleFamily, inferRoleFamily, titleIsApproved, isDiscoverySource,
  NON_DISCOVERY_SOURCES, QUERY_PACK_IDS, eligiblePackIds, buildQueryPack,
  DEFAULT_SOURCE_ORDER, type QueryPackId, type RoleFamilyDef,
} from "./leadRoleTaxonomy.ts";
import { buildSourcePlan, deriveSourceOrderingSignals } from "./leadSourceOrdering.ts";
import {
  LEAD_STRATEGY_SCHEMA_VERSION, type LeadStrategyMission, type LeadStrategyPlan,
  type LeadStrategyRoundContext, type LeadStrategyNextAction,
} from "./leadStrategyContract.ts";


export const MAX_TITLES = 24;
export const MAX_PACKS = 5;
export const MAX_QUERIES_PER_PACK = 12;
export const RATIONALE_MAX = 240;

const NEXT_ACTIONS: LeadStrategyNextAction[] = [
  "run_query_packs", "broaden_titles", "advance_source", "stop_quota_reached", "stop_valid_exhaustion",
];

const INJECTION_PATTERNS = [
  /ignore (all|any|previous|prior)/i,
  /disregard (the|all|any|previous)/i,
  /system prompt/i,
  /you are now/i,
  /\bexec\b|\beval\b|curl\s+http/i,
  /reveal (your|the) (prompt|instructions)/i,
];

export function detectStrategyInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export type ValidationResult =
  | { ok: true; plan: LeadStrategyPlan; dropped: string[] }
  | { ok: false; problem: string };

const clean = (s: unknown, max = RATIONALE_MAX): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Resolve the family the mission is actually about. Never model-chosen. */
export function resolveMissionFamily(mission: LeadStrategyMission): RoleFamilyDef | null {
  return inferRoleFamily([...mission.requested_titles, mission.original_query]);
}

export function validateLeadStrategy(
  candidate: unknown,
  mission: LeadStrategyMission,
  ctx: LeadStrategyRoundContext,
  fam: RoleFamilyDef,
): ValidationResult {
  if (!candidate || typeof candidate !== "object") return { ok: false, problem: "not_an_object" };
  const o = candidate as Record<string, unknown>;
  const dropped: string[] = [];

  // ---- role family: the model may NAME it, never CHANGE it -----------------
  const proposedFamily = getRoleFamily(typeof o.role_family === "string" ? o.role_family : null);
  if (proposedFamily && proposedFamily.key !== fam.key) return { ok: false, problem: "role_family_changed" };

  // ---- no-broadening: literal requested titles ONLY -------------------------
  //
  // `titleIsApproved` alone allows the whole family (exact + synonyms, and
  // adjacent when the round permits it) — appropriate for an ordinary
  // request, wrong for one that explicitly said "do not broaden": the family
  // itself is a form of broadening beyond what was literally asked for. Same
  // pattern as `plannerApprovedTitleUniverse` in broadeningPlan.ts (the
  // round-to-round broadening validator's equivalent fix) — this is the
  // initial-planning validator's own copy of the same invariant, since the
  // two are separate systems with separate title-approval functions.
  const noBroadening = mission.no_broadening_requested === true;
  const literalTitles = new Set(mission.requested_titles.map((t) => t.toLowerCase()));
  const isApproved = (t: string): boolean => {
    if (noBroadening) return literalTitles.has(t.toLowerCase());
    return titleIsApproved(fam, t, ctx.adjacent_titles_allowed);
  };

  // ---- titles --------------------------------------------------------------
  const rawTitles = Array.isArray(o.title_queries) ? o.title_queries : [];
  if (rawTitles.length === 0) return { ok: false, problem: "missing_title_queries" };
  if (!rawTitles.every((t) => typeof t === "string")) return { ok: false, problem: "title_queries_not_strings" };

  const titles: string[] = [];
  for (const raw of rawTitles as string[]) {
    const t = clean(raw, 80);
    if (!t) continue;
    if (!isApproved(t)) { dropped.push(`title:${t}`); continue; }
    if (!titles.some((x) => x.toLowerCase() === t.toLowerCase())) titles.push(t);
  }
  if (titles.length === 0) {
    return { ok: false, problem: noBroadening ? "broadening_prohibited_but_no_literal_title_survived" : "all_titles_out_of_universe" };
  }
  const finalTitles = titles.slice(0, MAX_TITLES);

  // ---- query packs: separate intents, eligible rounds only -----------------
  const eligible = new Set<QueryPackId>(eligiblePackIds(ctx.round, ctx.adjacent_titles_allowed));
  const rawPacks = Array.isArray(o.query_packs) ? o.query_packs : [];
  const seenPacks = new Set<string>();
  const packs: LeadStrategyPlan["query_packs"] = [];
  for (const p of rawPacks) {
    if (!p || typeof p !== "object") { dropped.push("pack:malformed"); continue; }
    const rec = p as Record<string, unknown>;
    const id = clean(rec.pack_id, 40) as QueryPackId;
    if (!QUERY_PACK_IDS.includes(id)) { dropped.push(`pack:${id || "unknown"}`); continue; }
    if (!eligible.has(id)) { dropped.push(`pack_not_eligible:${id}`); continue; }
    if (seenPacks.has(id)) { dropped.push(`pack_duplicate:${id}`); continue; }
    const allowed = new Set(buildQueryPack(id, fam, ctx.adjacent_titles_allowed).map((q) => q.toLowerCase()));
    const proposed = Array.isArray(rec.queries) ? rec.queries : [];
    const queries: string[] = [];
    for (const q of proposed) {
      const s = clean(q, 80);
      if (!s) continue;
      if (!isApproved(s)) { dropped.push(`query:${s}`); continue; }
      if (!noBroadening && allowed.size > 0 && !allowed.has(s.toLowerCase()) && !finalTitles.some((t) => t.toLowerCase() === s.toLowerCase())) {
        dropped.push(`query_off_pack:${s}`);
        continue;
      }
      if (!queries.some((x) => x.toLowerCase() === s.toLowerCase())) queries.push(s);
    }
    const resolved = queries.length > 0 ? queries : (noBroadening ? [] : buildQueryPack(id, fam, ctx.adjacent_titles_allowed));
    if (resolved.length === 0) { dropped.push(`pack_empty:${id}`); continue; }
    seenPacks.add(id);
    packs.push({ pack_id: id, queries: resolved.slice(0, MAX_QUERIES_PER_PACK), rationale: clean(rec.rationale) });
    if (packs.length >= MAX_PACKS) break;
  }
  if (packs.length === 0) return { ok: false, problem: "no_valid_query_packs" };

  // ---- required signal: must be represented, not silently dropped ----------
  //
  // `mission.required_signal_terms` is the literal role/signal the user named
  // (e.g. "RevOps"), computed regardless of hiring_signal_required. A plan
  // whose approved titles/queries relate to none of them has quietly
  // substituted a broader or different signal for the one actually requested
  // — reject it here rather than let it become `model_validated`.
  const signalTerms = (mission.required_signal_terms ?? []).map((s) => s.toLowerCase()).filter(Boolean);
  if (signalTerms.length > 0) {
    const haystack = [...finalTitles, ...packs.flatMap((p) => p.queries)]
      .map((s) => s.toLowerCase());
    const represented = signalTerms.some((term) => haystack.some((h) => h.includes(term) || term.includes(h)));
    if (!represented) return { ok: false, problem: "required_signal_not_represented" };
  }

  // A pack must not be a copy of another pack — separation is the whole point.
  //
  // DETERMINISTIC REPAIR BEFORE ESCALATION. This used to reject the ENTIRE
  // strategy the moment two packs shared a title signature, discarding a plan
  // whose sources, titles and order were otherwise valid and forcing an
  // escalation (or the deterministic fallback) over a duplicate. Collapsing an
  // exact duplicate is safe and invents nothing: the surviving pack is the
  // NARROWER one (fewer queries), or on a tie the earlier one, which is the
  // higher-priority position the strategist itself chose.
  //
  // Only EXACT signature duplicates collapse. Packs that merely overlap keep
  // their own identity, because a narrower pack is still a separate experiment.
  const bySignature = new Map<string, number>();
  const collapsed: typeof packs = [];
  for (const pack of packs) {
    const sig = pack.queries.map((q) => q.toLowerCase()).sort().join("|");
    const priorIndex = bySignature.get(sig);
    if (priorIndex === undefined) {
      bySignature.set(sig, collapsed.length);
      collapsed.push(pack);
      continue;
    }
    const prior = collapsed[priorIndex];
    // Keep the narrower pack; on a tie keep the earlier (higher-priority) one.
    if (pack.queries.length < prior.queries.length) {
      dropped.push(`pack_duplicate_signature_repaired:${prior.pack_id}`);
      collapsed[priorIndex] = pack;
    } else {
      dropped.push(`pack_duplicate_signature_repaired:${pack.pack_id}`);
    }
  }
  packs.length = 0;
  packs.push(...collapsed);
  if (packs.length === 0) return { ok: false, problem: "no_valid_query_packs" };

  // ---- sources -------------------------------------------------------------
  const rawSources = Array.isArray(o.source_plan) ? o.source_plan : [];
  const seenSources = new Set<string>();
  const sources: LeadStrategyPlan["source_plan"] = [];
  for (const s of rawSources) {
    if (!s || typeof s !== "object") { dropped.push("source:malformed"); continue; }
    const rec = s as Record<string, unknown>;
    const key = clean(rec.source_key, 40).toLowerCase();
    if (NON_DISCOVERY_SOURCES.includes(key)) { dropped.push(`source_not_discovery:${key}`); continue; }
    if (!isDiscoverySource(key)) { dropped.push(`source_unknown:${key}`); continue; }
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    sources.push({
      source_key: key,
      priority: typeof rec.priority === "number" && rec.priority > 0 ? Math.floor(rec.priority) : sources.length + 1,
      rationale: clean(rec.rationale),
    });
  }
  const finalSources = sources.length > 0
    ? sources.slice().sort((a, b) => a.priority - b.priority)
    : buildSourcePlan(deriveSourceOrderingSignals(mission, ctx, {
      unusedQueryPacks: eligiblePackIds(ctx.round, ctx.adjacent_titles_allowed)
        .filter((id) => !ctx.attempted_query_packs.includes(id)),
    }));


  // ---- next action + prose safety -----------------------------------------
  const nextAction = NEXT_ACTIONS.includes(o.next_action as LeadStrategyNextAction)
    ? (o.next_action as LeadStrategyNextAction)
    : "run_query_packs";
  const rationale = clean(o.rationale);
  if (rationale && detectStrategyInjection(rationale)) return { ok: false, problem: "security_rejected" };
  for (const p of packs) if (p.rationale && detectStrategyInjection(p.rationale)) return { ok: false, problem: "security_rejected" };

  const confidence = typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : 0.5;

  const excluded = (Array.isArray(o.excluded_titles) ? o.excluded_titles : [])
    .map((t) => clean(t, 80)).filter(Boolean).slice(0, MAX_TITLES);
  const stops = (Array.isArray(o.stop_conditions) ? o.stop_conditions : [])
    .map((t) => clean(t, 120)).filter(Boolean).slice(0, 8);

  return {
    ok: true,
    dropped,
    plan: {
      schema_version: LEAD_STRATEGY_SCHEMA_VERSION,
      role_family: fam.key,
      title_queries: finalTitles,
      excluded_titles: excluded,
      query_packs: packs,
      source_plan: finalSources,
      next_action: nextAction,
      stop_conditions: stops.length > 0 ? stops : ["quota_reached", "budget_exhausted", "sources_exhausted"],
      rationale: rationale || "openai lead strategy",
      confidence,
    },
  };
}

/**
 * The plan that always exists. Used when the model is disabled, unreachable, or
 * returns something that fails validation — the run continues, deterministically.
 */
export function deterministicLeadStrategy(
  mission: LeadStrategyMission,
  ctx: LeadStrategyRoundContext,
  fam: RoleFamilyDef,
): LeadStrategyPlan {
  // NO-BROADENING: the fallback the user is told is "safe" was itself always
  // building the full family's query packs — every bit as much a broadening
  // of "SDR" into "Sales Operations, Revenue Operations, GTM Operations" as
  // an unvalidated model plan would have been. When the mission says do not
  // broaden and named a literal title, the fallback must honour that too, not
  // just the model-facing validator.
  const noBroadening = mission.no_broadening_requested === true && mission.requested_titles.length > 0;
  if (noBroadening) {
    const literal = [...new Set(mission.requested_titles)].slice(0, MAX_TITLES);
    const signals = deriveSourceOrderingSignals(mission, ctx, { unusedQueryPacks: [] });
    const scoredPlan = buildSourcePlan(signals);
    const unattempted = scoredPlan.filter((s) => !ctx.attempted_sources.includes(s.source_key));
    const plan = (unattempted.length > 0 ? unattempted : scoredPlan).map((s, i) => ({ ...s, priority: i + 1 }));
    return {
      schema_version: LEAD_STRATEGY_SCHEMA_VERSION,
      role_family: fam.key,
      title_queries: literal,
      excluded_titles: [...fam.negatives],
      query_packs: [{ pack_id: "exact_titles" as QueryPackId, queries: literal, rationale: "no-broadening: literal request only" }],
      source_plan: plan,
      next_action: ctx.remaining_quota <= 0 ? "stop_quota_reached" : "run_query_packs",
      stop_conditions: ["quota_reached", "budget_exhausted", "sources_exhausted", "no_broadening_requested"],
      rationale: `deterministic strategy honouring an explicit no-broadening request (round ${ctx.round})`,
      confidence: 0.4,
    };
  }

  const packIds = eligiblePackIds(ctx.round, ctx.adjacent_titles_allowed)
    .filter((id) => !ctx.attempted_query_packs.includes(id))
    .slice(0, MAX_PACKS);
  const chosen = packIds.length > 0 ? packIds : (["exact_titles"] as QueryPackId[]);
  const packs = chosen
    .map((id) => ({ pack_id: id, queries: buildQueryPack(id, fam, ctx.adjacent_titles_allowed), rationale: "deterministic pack" }))
    .filter((p) => p.queries.length > 0);
  let titles = [...new Set(packs.flatMap((p) => p.queries))].slice(0, MAX_TITLES);

  // REQUIRED SIGNAL, EVEN OUTSIDE A NO-BROADENING REQUEST. The family-based
  // packs above have no idea "RevOps" or "GTM roles" was the literal signal
  // named — they only know the (possibly wrong-default, per
  // resolveMissionFamily) family. If the family's own generic titles happen
  // not to mention it, the signal silently becomes optional in the one plan
  // nothing downstream re-validates. Merged into the existing pack set
  // (never a new pack_id) so this stays inside the same taxonomy the rest of
  // the plan already uses, broad where the request allows broadening and
  // precise where it named something specific.
  const signalTerms = (mission.required_signal_terms ?? []).filter(Boolean);
  const represented = signalTerms.length === 0 || signalTerms.some((term) =>
    titles.some((t) => t.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(t.toLowerCase())));
  const finalPacks = packs.length > 0
    ? packs
    : [{ pack_id: "exact_titles" as QueryPackId, queries: [...fam.exact], rationale: "deterministic pack" }];
  if (!represented) {
    finalPacks[0] = { ...finalPacks[0], queries: [...new Set([...signalTerms, ...finalPacks[0].queries])] };
    titles = [...new Set([...signalTerms, ...titles])].slice(0, MAX_TITLES);
  }

  const signals = deriveSourceOrderingSignals(mission, ctx, { unusedQueryPacks: packIds });
  const scoredPlan = buildSourcePlan(signals);
  const unattempted = scoredPlan.filter((s) => !ctx.attempted_sources.includes(s.source_key));
  const plan = (unattempted.length > 0 ? unattempted : scoredPlan)
    .map((s, i) => ({ ...s, priority: i + 1 }));

  return {
    schema_version: LEAD_STRATEGY_SCHEMA_VERSION,
    role_family: fam.key,
    title_queries: titles.length > 0 ? titles : [...fam.exact],
    excluded_titles: [...fam.negatives],
    query_packs: finalPacks,
    source_plan: plan,
    next_action: ctx.remaining_quota <= 0 ? "stop_quota_reached" : "run_query_packs",
    stop_conditions: ["quota_reached", "budget_exhausted", "sources_exhausted"],
    rationale: `deterministic strategy for ${fam.label} (round ${ctx.round})`,
    confidence: 0.4,
  };
}

export { getRoleFamily };
