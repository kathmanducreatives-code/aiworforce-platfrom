// LEAD V2 P1 — MISSION MEANING IS EXPLICIT AND STABLE.
//
// Every case runs the REAL compiler (`compileLeadMission`) over a realistic
// model proposal — including the exact proposal shape behind the live misread
// of "just hired a new VP of Sales" as an open-role hiring search. No network,
// no provider, no model call.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  canonicalMissionView, criteriaSections, deriveMissionCriteria, type MissionCriterion,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { readCanonicalSignals } from "../../../supabase/functions/_shared/signalKinds.ts";
import { missionHash, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";

globalThis.fetch = () => { throw new Error("P1 must not reach the network"); };

function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requested_opportunity_count: 5, requested_contact_ready_count: null,
    company_types: [], geographies: [], employee_range: { min: null, max: null },
    decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [],
    preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.8, unknowns: [], ...over,
  };
}

function compile(query: string, over: Record<string, unknown> = {}, companyBrain?: Record<string, unknown>) {
  return compileLeadMission({ originalUserQuery: query, proposal: proposal(over), ...(companyBrain ? { companyBrain } : {}) });
}
const events = (m: LeadMissionV1) => m.required_signals.map((s) => String(s.event ?? s.type));
const crit = (m: LeadMissionV1, dim: string) => (m.criteria ?? []).filter((c) => c.dimension === dim);
const one = (m: LeadMissionV1, dim: string): MissionCriterion => {
  const c = crit(m, dim); assertEquals(c.length, 1, `${dim}: ${JSON.stringify(c)}`); return c[0];
};

// ── the canonical representation ─────────────────────────────────────────────

Deno.test("every compiled mission carries goal, count, criteria and canonical signals", () => {
  const r = compile("Find 3 US B2B SaaS companies hiring growth marketers.", {
    requested_opportunity_count: 3, company_types: ["B2B SaaS"], geographies: ["United States"],
    geography_is_hard: true, preferred_signals: ["hiring growth marketers"],
  });
  const v = canonicalMissionView(r.final_mission);
  assertEquals(v.goal, "Find 3 US B2B SaaS companies hiring growth marketers.");
  assertEquals(v.requested_count, 3);
  assert(v.criteria.length > 0);
  for (const c of v.criteria) {
    assert(["hard", "target", "opportunity_signal", "hypothesis"].includes(c.kind), c.id);
    assert(["user_explicit", "user_inferred", "company_brain_policy", "company_brain_preference", "system_default"]
      .includes(c.source), c.id);
    if (c.source === "user_inferred") assert(typeof c.confidence === "number", `${c.id} inferred needs confidence`);
  }
  assertEquals(v.canonical_signals.map((s) => s.kind), ["hiring"]);
  assertEquals(r.final_mission.mission_semantics?.version, "mission-semantics-v1");
});

Deno.test('"hiring growth marketers" → hiring target, role kept, default window shown but not claimed as enforced', () => {
  const m = compile("Find US B2B SaaS companies hiring growth marketers.", {
    company_types: ["B2B SaaS"], geographies: ["United States"], preferred_signals: ["hiring growth marketers"],
  }).final_mission;
  assertEquals(events(m), ["hiring"]);
  const h = one(m, "hiring");
  assertEquals(h.kind, "target");
  assertEquals(h.source, "user_explicit");
  assert(h.label.includes("growth marketer"), h.label);
  assertEquals(h.time_window?.days, 30);
  assertEquals(h.time_window?.source, "system_default");
  assertEquals(m.required_signals[0].timeframe_days, undefined, "hiring window is shown, not carried");
  assert(criteriaSections(m).time_windows.some((l) => l.includes("not yet enforced")));
});

// ── the leadership misread ───────────────────────────────────────────────────

Deno.test('"just hired a VP Sales" → leadership_change, never ordinary hiring (live proposal shape)', () => {
  for (const query of ["Find 5 companies that just hired a new VP of Sales.", "Find companies that just hired a VP Sales."]) {
    const r = compile(query, { preferred_signals: ["hiring VP of Sales"], required_signal_terms: ["VP of Sales"] });
    const m = r.final_mission;
    assertEquals(events(m), ["leadership_change"], query);
    assertFalse(events(m).includes("hiring"), query);
    assert(r.validator_changes.some((c) => c.startsWith("semantic_correction:hiring->leadership_change")), query);
    const lc = one(m, "leadership_change");
    assertEquals(lc.source, "user_explicit");
    assert(/vp/i.test(lc.label), lc.label);
    assertEquals(lc.time_window?.days, 120);
    assertEquals(crit(m, "hiring").length, 0);
  }
});

Deno.test('an OPEN executive role stays hiring; a mixed request keeps both', () => {
  const open = compile("Find companies hiring a new VP of Sales.", { preferred_signals: ["hiring VP of Sales"] }).final_mission;
  assertEquals(events(open), ["hiring"]);
  const mixed = compile("Find companies that just hired a VP Sales and are hiring SDRs.", {
    preferred_signals: ["hiring SDRs"],
  }).final_mission;
  assertEquals(events(mixed).sort(), ["hiring", "leadership_change"]);
});

Deno.test("the corrected leadership mission still fails truthfully under the P0 gate", () => {
  const m = compile("Find 5 companies that just hired a new VP of Sales.", {
    preferred_signals: ["hiring VP of Sales"],
  }).final_mission;
  const plan = buildCapabilityGraph(m, { executability: "enforce" });
  const f = assessRequestFeasibility(m, plan, { executability: "enforce" });
  assertFalse(f.ok, "no executable source proves a leadership change — refused before spend");
  assertFalse(plan.steps.some((s) => s.capability === "hiring_verification"), "no open-role search is planned");
});

// ── funding, expansion, social activity ─────────────────────────────────────

Deno.test('"recently raised funding" → funding with an explicit, visible window', () => {
  const m = compile("Find US B2B SaaS companies that recently raised funding.", {
    company_types: ["B2B SaaS"], geographies: ["United States"], preferred_signals: ["recent funding"],
  }).final_mission;
  assertEquals(events(m), ["funding"]);
  assertEquals(m.required_signals[0].timeframe_days, 180);
  const f = one(m, "funding");
  assertEquals(f.time_window?.days, 180);
  assertEquals(f.time_window?.source, "system_default");
  assert(criteriaSections(m).time_windows.some((l) => l.startsWith("Funding: last 180 days")));

  const inferred = compile("Find US B2B SaaS companies that recently raised funding.", {
    preferred_signals: ["recent funding"], signal_recency_days: 90, confidence: 0.7,
  }).final_mission;
  assertEquals(one(inferred, "funding").time_window?.source, "user_inferred");
  assertEquals(inferred.mission_semantics?.window_sources.funding?.confidence, 0.7);

  const stated = compile("Find companies that raised funding in the last 60 days.", {
    preferred_signals: ["funding"], signal_recency_days: 90,
  }).final_mission;
  assertEquals(stated.required_signals[0].timeframe_days, 60, "the user's number wins");
  assertEquals(one(stated, "funding").time_window?.source, "user_explicit");
});

Deno.test('"opened a new office" → expansion / geographic_expansion, even when the model dropped it', () => {
  const r = compile("Find companies that recently opened a new office in the US.", {
    geographies: ["United States"], geography_is_hard: true,
  });
  const m = r.final_mission;
  assertEquals(events(m), ["expansion"]);
  assert(r.validator_changes.some((c) => c.startsWith("semantic_signal_added:expansion")));
  assertEquals(m.mission_semantics?.canonical_signals[0].subkind, "geographic_expansion");
  assertEquals(one(m, "expansion").time_window?.days, 180);
});

Deno.test('"strong LinkedIn activity" → social_activity, never a silent plain company search', () => {
  const m = compile("Find companies with strong recent LinkedIn activity.").final_mission;
  assertEquals(events(m), ["post"]);
  assertEquals(m.mission_semantics?.canonical_signals.map((s) => s.kind), ["social_activity"]);
  assert(criteriaSections(m).opportunity_signals.some((l) => l.startsWith("LinkedIn / social activity")));
});

// ── hypotheses ───────────────────────────────────────────────────────────────

Deno.test('"likely to need a growth marketer soon" → hypothesis with proxies, not a verified signal', () => {
  const r = compile("Find B2B SaaS startups likely to need a growth marketer soon.", {
    company_types: ["B2B SaaS"], preferred_signals: ["hiring growth marketer"],
  });
  const m = r.final_mission;
  assertEquals(events(m), [], "the thesis does not become a required hiring signal");
  assert(r.validator_changes.some((c) => c.startsWith("hypothesis_not_a_verified_signal:hiring")));
  const hyp = (m.criteria ?? []).filter((c) => c.kind === "hypothesis");
  assertEquals(hyp.length, 1);
  assert(hyp[0].value === "likely to need a growth marketer soon", String(hyp[0].value));
  const proxies = (m.criteria ?? []).filter((c) => c.kind === "opportunity_signal");
  assert(proxies.length >= 2 && proxies.every((p) => p.source === "system_default"));
  assert(proxies.every((p) => !p.label.includes("soon")), "the time word is not a role");
  const s = criteriaSections(m);
  assertEquals(s.hypotheses.length, 1);
  assert(s.hypotheses[0].includes("never required"));
});

// ── stage: ONLY vs prefer ────────────────────────────────────────────────────

Deno.test('"ONLY seed-stage" → seed hard, carried as a hard constraint, provable now the funding pair is READY', () => {
  const r = compile("Find ONLY seed-stage B2B SaaS startups in the US hiring their first growth marketer.", {
    company_types: ["B2B SaaS"], geographies: ["United States"], preferred_signals: ["hiring growth marketer"],
  });
  const m = r.final_mission;
  assertEquals((m.hard_constraints.stage as { value: string }).value, "seed");
  const seed = (m.criteria ?? []).find((c) => c.dimension === "company_stage" && c.value === "seed")!;
  assertEquals(seed.kind, "hard");
  assertEquals(seed.elevated_by, "only");
  // Was `unprovable_today` while no funding verifier could run. The
  // corroborating pair has been READY since 2026-09-22, so a round stage is
  // establishable per company — and is therefore NOT disclosed as unsupported.
  assertEquals(seed.status, "ok");
  const s = criteriaSections(m);
  assert(s.hard.some((l) => l.includes("seed")));
  assert(!s.unsupported.some((l) => l.includes("seed")), "a provable rung is not listed as unsupported");
});

Deno.test('"prefer seed-stage" → seed target; a model-written hard stage is demoted and recorded', () => {
  const r = compile("Find B2B SaaS startups hiring growth marketers, prefer seed-stage.", {
    company_types: ["B2B SaaS"], preferred_signals: ["hiring growth marketers"],
    hard_constraints: [{ field: "stage", operator: "equals", value: "seed", reason: "seed-stage" }],
  });
  const m = r.final_mission;
  assertEquals(m.hard_constraints.stage, undefined);
  assertEquals((m.soft_preferences.stage as { value: string }).value, "seed");
  assert(r.validator_changes.includes("stage_hard_constraint_demoted_to_target:seed:hedged"));
  const seed = (m.criteria ?? []).find((c) => c.dimension === "company_stage" && c.value === "seed")!;
  assertEquals(seed.kind, "target");
  assert(criteriaSections(m).target.some((l) => l.includes("seed")));
});

Deno.test("unqualified seed-stage is a target (plan rule), not silently hard", () => {
  const m = compile("Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.", {
    requested_opportunity_count: 1, company_types: ["B2B SaaS"], geographies: ["United States"],
    preferred_signals: ["hiring growth marketer"],
    hard_constraints: [{ field: "stage", operator: "equals", value: "seed", reason: "seed-stage" }],
  }).final_mission;
  assertEquals(m.hard_constraints.stage, undefined);
  assertEquals((m.criteria ?? []).find((c) => c.value === "seed")?.kind, "target");
});

// ── unknown language, Company Brain provenance ──────────────────────────────

Deno.test("unknown signal language never silently disappears", () => {
  const r = compile("Find B2B SaaS companies with strong community momentum.", { company_types: ["B2B SaaS"] });
  const m = r.final_mission;
  assert((m.unrepresented_requirements ?? []).some((u) => u.includes("strong community momentum")));
  const u = (m.criteria ?? []).filter((c) => c.status === "unrecognised");
  assertEquals(u.length, 1);
  assert(criteriaSections(m).unsupported.some((l) => l.includes("strong community momentum")));
  assert(r.validator_changes.some((c) => c.startsWith("unrecognised_signal_recorded")));

  // A model signal the vocabulary cannot read is also shown, never dropped.
  const odd = compile("Find companies with momentum.", { preferred_signals: ["buzz"] }).final_mission;
  assert((odd.criteria ?? []).some((c) => c.status === "unrecognised"), JSON.stringify(odd.criteria));
});

Deno.test("Company Brain additions carry provenance and never pose as the user's words", () => {
  const brain = { locations: ["United States"], employee_min: 1, employee_max: 150, industries: ["B2B SaaS"] };
  const filled = compile("Find startups hiring growth marketers.", {
    preferred_signals: ["hiring growth marketers"],
  }, brain).final_mission;
  const geo = one(filled, "geography");
  assertEquals(geo.source, "company_brain_preference");
  assertEquals(geo.kind, "target", "a Brain preference can rank, never be a hard constraint");
  assertEquals(one(filled, "company_size").source, "company_brain_preference");
  assert(criteriaSections(filled).target.some((l) => l.includes("from your Company Brain")));

  const explicit = compile("Find fintech companies in Germany hiring SDRs.", {
    company_types: ["fintech"], geographies: ["Germany"], geography_is_hard: true, preferred_signals: ["hiring SDRs"],
  }, brain).final_mission;
  const geos = crit(explicit, "geography");
  assertEquals(geos.map((g) => [g.value, g.source, g.kind]), [["Germany", "user_explicit", "hard"]],
    "the Brain's US did not replace the user's Germany");
  assertFalse((explicit.criteria ?? []).some((c) => c.source === "company_brain_preference" && c.dimension === "industry"),
    "the Brain's industry did not widen the user's fintech");
});

Deno.test("criteria re-derived after a later Brain merge reflect the new provenance", () => {
  const m = compile("Find startups hiring growth marketers.", { preferred_signals: ["hiring growth marketers"] }).final_mission;
  const merged: LeadMissionV1 = {
    ...m,
    company_profile: { ...m.company_profile, locations: ["United States"] },
    field_provenance: { ...m.field_provenance, "company_profile.locations": "company_brain" },
  };
  assertEquals(one({ ...merged, criteria: deriveMissionCriteria(merged) }, "geography").source, "company_brain_preference");
});

// ── stability ────────────────────────────────────────────────────────────────

Deno.test("meaning is stable: the same words give the same criteria whatever the model's phrasing", () => {
  const q = "Find 5 companies that just hired a new VP of Sales.";
  const a = compile(q, { preferred_signals: ["hiring VP of Sales"] }).final_mission;
  const b = compile(q, { preferred_signals: ["leadership change"] }).final_mission;
  const c = compile(q, {}).final_mission;
  const shape = (m: LeadMissionV1) => (m.criteria ?? []).map((x) => [x.dimension, x.kind, x.source]);
  assertEquals(shape(a), shape(b));
  assertEquals(shape(a), shape(c));
});

Deno.test("criteria are not part of the mission's identity (resume/idempotency unchanged)", async () => {
  const m = compile("Find US B2B SaaS companies hiring growth marketers.", {
    preferred_signals: ["hiring growth marketers"],
  }).final_mission;
  const bare = { ...m } as LeadMissionV1;
  delete bare.criteria; delete bare.mission_semantics;
  assertEquals(await missionHash(m), await missionHash(bare));
});

Deno.test("the alias module reads the regression phrasings from the user's words alone", () => {
  const kinds = (q: string) => readCanonicalSignals(q).map((r) => r.kind);
  assertEquals(kinds("just hired a VP Sales"), ["leadership_change"]);
  assertEquals(kinds("recently raised funding"), ["funding"]);
  assertEquals(kinds("opened a new office"), ["expansion"]);
  assertEquals(kinds("strong LinkedIn activity"), ["social_activity"]);
  assertEquals(kinds("likely to need a growth marketer soon"), []);
  assertEquals(kinds("rapidly expanding headcount"), ["headcount_growth"]);
});
