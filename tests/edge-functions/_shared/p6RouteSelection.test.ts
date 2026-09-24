// LEAD V2 P6 — ROUTE SELECTION: THE ENTRY IS A TABLE, THE NEXT PROOF IS THE CHEAPEST OPEN ROUTE.
//
// Pins:
//   - entry selection is an ordered table, every candidate considered is
//     recorded under V2, and legacy (V1 / Signals) plans carry no record of it;
//   - named companies skip discovery; a hiring-led mission enters through the role;
//   - production enters only through a READY route; a carded one runs only in
//     an explicit provider probe, which says so; nothing runnable is refused;
//   - a gap is routed to the CHEAPEST executable route, whatever the registry order;
//   - a target ("first in the function") schedules no paid verification.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { CLAIM_REGISTRY, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";

const V2 = { executability: "enforce" as const };
const mission = (q: string) => parseLeadMissionDeterministic(q);

const HIRING = mission("Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.");
const KNOWN = mission("Research stripe.com and linear.app");
const FUNDED = mission("Find recently Seed-funded companies");
const PROFILE = mission("Find B2B SaaS companies");

/** The routes a probe canary would open: funding and profile discovery. */
const PROBE = { ...V2, readiness: readinessPolicy({ mode: "provider_probe", probe_routes: [
  "apify_funding_rounds_datahyena|funding_signal_discovery", "apify_linkedin_company_search|general_company_discovery",
] }) };

Deno.test("V2 records every entry considered, in order, ending at the one taken", () => {
  for (const m of [HIRING, KNOWN, FUNDED, PROFILE]) {
    const plan = buildCapabilityGraph(m, PROBE);
    const sel = plan.entry_selection!;
    assert(sel, "a V2 plan says how its entry was chosen");
    const last = sel.considered[sel.considered.length - 1];
    assertEquals(last.capability, plan.entry_capability);
    assert(last.applies, "the entry taken is the first that applies");
    assert(sel.considered.slice(0, -1).every((c) => !c.applies), "nothing before it applied");
  }
});

Deno.test("legacy (V1 / Signals) plans carry no entry record and no readiness advisory", () => {
  for (const m of [HIRING, KNOWN, FUNDED, PROFILE]) {
    const plan = buildCapabilityGraph(m);
    assertEquals(plan.entry_selection, undefined);
    assertFalse(plan.routing_advisories.some((a) => /Actor Intelligence/.test(a)));
  }
});

Deno.test("named companies skip discovery: the first row of the table, nothing else weighed", () => {
  const plan = buildCapabilityGraph(KNOWN, V2);
  assertEquals(plan.entry_capability, "known_company_resolution");
  assertEquals(plan.entry_selection!.considered.length, 1);
  assertEquals(plan.entry_selection!.readiness, "ENGINE", "resolving a named company buys no discovery actor");
});

Deno.test("a hiring-led mission enters through the role, on a READY actor, with no readiness advisory", () => {
  const plan = buildCapabilityGraph(HIRING, V2);
  assertEquals(plan.entry_capability, "job_discovery");
  assertEquals(plan.entry_selection!.readiness, "READY");
  assertFalse(plan.routing_advisories.some((a) => /Actor Intelligence/.test(a)));
  // The directory rows below it were never weighed — the table stops at the first that applies.
  assertFalse(plan.entry_selection!.considered.some((c) => c.capability === "startup_company_discovery"));
});

Deno.test("PRODUCTION: an entry never run live is not taken — profile and funding missions enter by the READY company search", () => {
  // general_company_discovery has been READY since canary 89adf8fb (2026-09-24).
  // Funding DISCOVERY is still carded: it is weighed, refused, and the mission
  // falls through to the proven route — funding is then VERIFIED per company.
  for (const m of [FUNDED, PROFILE]) {
    const plan = buildCapabilityGraph(m, V2);
    assert(plan.entry_selection!.runnable);
    assertEquals([plan.entry_capability, plan.entry_selection!.mode, plan.entry_selection!.readiness],
      ["general_company_discovery", "production", "READY"]);
    const funding = plan.entry_selection!.considered.filter((c) => c.capability === "funding_signal_discovery");
    assert(funding.every((c) => !c.applies), "the unproven funding-discovery row is weighed and refused");
    assertFalse(plan.allowed_providers.includes("apify_funding_rounds_datahyena"), "no unproven actor is handed on");
    assertFalse(plan.allowed_providers.includes("apify_yc_companies_solidcode"));
  }
});

Deno.test("PROVIDER PROBE: the opened route is taken, and the plan says it is a probe", () => {
  const plan = buildCapabilityGraph(FUNDED, PROBE);
  assertEquals(plan.entry_capability, "funding_signal_discovery");
  assert(plan.entry_selection!.runnable);
  assertEquals([plan.entry_selection!.mode, plan.entry_selection!.readiness], ["provider_probe", "CARDED_BUT_NOT_LIVE"]);
  assert(plan.routing_advisories.some((a) => a.startsWith("PROVIDER PROBE") && a.includes("apify_funding_rounds_datahyena")));
  // A probe opens exactly what it names — and leaves READY routes READY: a
  // profile mission under a funding-only probe enters by production readiness.
  const fundingOnly = { ...V2, readiness: readinessPolicy({ mode: "provider_probe",
    probe_routes: ["apify_funding_rounds_datahyena|funding_signal_discovery"] }) };
  const profile = buildCapabilityGraph(PROFILE, fundingOnly);
  assertEquals([profile.entry_capability, profile.entry_selection!.readiness], ["general_company_discovery", "READY"]);
  assertFalse(profile.allowed_providers.includes("apify_funding_rounds_datahyena"), "the probe's route is not this mission's");
});

Deno.test("the ENTRY GATE is the readiness decision: demote the job actor and a hiring mission cannot enter by jobs", () => {
  // Production today: the job route is READY.
  assertEquals(buildCapabilityGraph(HIRING, V2).entry_capability, "job_discovery");
  // The same mission, the same code, with only the actor's class changed.
  const demoted = readinessPolicy({ overrides: { "apify_linkedin_job_search|job_discovery": "NEEDS_PROVIDER_WORK" } });
  const plan = buildCapabilityGraph(HIRING, { ...V2, readiness: demoted });
  assert(plan.entry_capability !== "job_discovery", plan.entry_capability);
  const passed = plan.entry_selection!.considered.filter((c) => c.capability === "job_discovery");
  assert(passed.length > 0 && passed.every((c) => !c.applies), "weighed and refused");
  assert(plan.executability!.unexecutable.some((u) => u.capability === "job_discovery" && u.readiness === "NEEDS_PROVIDER_WORK"));
  // …and promoting the funding actor alone lets a funding mission enter by funding.
  const promoted = readinessPolicy({ overrides: { "apify_funding_rounds_datahyena|funding_signal_discovery": "READY" } });
  assertEquals(buildCapabilityGraph(FUNDED, { ...V2, readiness: promoted }).entry_capability, "funding_signal_discovery");
});

Deno.test("EXPERIMENTAL runs only when explicitly allowed", () => {
  const exp = { "apify_funding_rounds_datahyena|funding_signal_discovery": "EXPERIMENTAL" as const };
  // Not allowed: the funding-discovery entry is refused and the READY company search is taken instead.
  const refused = buildCapabilityGraph(FUNDED, { ...V2, readiness: readinessPolicy({ overrides: exp }) });
  assert(refused.entry_capability !== "funding_signal_discovery");
  assertFalse(refused.allowed_providers.includes("apify_funding_rounds_datahyena"));
  const allowed = readinessPolicy({ overrides: exp, allow_experimental: ["apify_funding_rounds_datahyena|funding_signal_discovery"] });
  assertEquals(buildCapabilityGraph(FUNDED, { ...V2, readiness: allowed }).entry_capability, "funding_signal_discovery");
});

Deno.test("a step keeps only the actors that may run", () => {
  const plan = buildCapabilityGraph(PROFILE, PROBE);
  for (const st of plan.steps) {
    for (const p of st.providers) assert(PROBE.readiness.decide(p, st.capability).executable, `${st.capability}/${p}`);
  }
});

Deno.test("an entry no actor can run is passed over, and the plan records why", () => {
  // Expansion discovery's only actor needs extraction work, so the capability
  // itself is unexecutable; a V2 expansion mission must not enter through it.
  const plan = buildCapabilityGraph(mission("Find companies expanding to London"), V2);
  assert(plan.entry_capability !== "expansion_signal_discovery");
  const passed = plan.entry_selection!.considered.find((c) => c.capability === "expansion_signal_discovery");
  assert(passed && !passed.applies, "expansion discovery was weighed and refused");
  assert(plan.executability!.unexecutable.some((u) => u.capability === "expansion_signal_discovery" && u.role === "entry"));
});

// ── the next proof: cheapest executable route first ──────────────────────

const NOW = new Date("2026-09-19T12:00:00.000Z");
const EMPTY = buildCompanyEvidenceGraph("acme", [], { now: NOW });
const unknownIndustry = { criterion_id: "industry:x", dimension: "industry", result: "unknown", reason: "industry is not established" };

Deno.test("a gap goes to the cheapest route that can answer it, whatever order the registry lists", () => {
  const [forward] = evidenceGapsFor([unknownIndustry], EMPTY);
  const reversed = CLAIM_REGISTRY.map((d) => d.claim === "business_model" ? { ...d, routes: [...d.routes].reverse() } : d);
  const [backward] = evidenceGapsFor([unknownIndustry], EMPTY, reversed);
  assertEquals(forward.route?.actor, "apify_linkedin_company_details");
  assertEquals(backward.route?.actor, "apify_linkedin_company_details", "registry order does not decide");
  const costs = forward.considered.filter((r) => r.executable).map((r) => r.cost_hint_usd);
  assertEquals(forward.route!.cost_hint_usd, Math.min(...costs));
});

Deno.test("once the cheap route has answered, the dearer one is next — never the same route twice", () => {
  const [g] = evidenceGapsFor([unknownIndustry], EMPTY, undefined, new Set(["apify_linkedin_company_details"]));
  assertEquals(g.route?.actor, "firecrawl");
  assert(g.considered.find((r) => r.actor === "apify_linkedin_company_details")!.tried);
});

Deno.test("every registered route carries a positive cost hint", () => {
  for (const d of CLAIM_REGISTRY) for (const r of d.routes) assert(r.cost_hint_usd > 0, `${d.claim}/${r.actor}`);
});

Deno.test("a first-in-function TARGET schedules no paid team lookup, in V1 or V2", () => {
  for (const plan of [buildCapabilityGraph(HIRING), buildCapabilityGraph(HIRING, V2)]) {
    assertFalse(plan.allowed_providers.includes("apify_linkedin_company_employees"));
    assertFalse(plan.steps.some((s) => s.providers.includes("apify_linkedin_company_employees")));
  }
});

Deno.test("a READY actor gated off this mission does not make its entry runnable (a YC directory, no startup cohort)", () => {
  // The compiled mission ASKS for startup discovery but describes no startup
  // and names no YC cohort: memo23 is READY, but the cohort rule refuses it
  // for this mission, so the startup row cannot be entered through it.
  const base = parseLeadMissionDeterministic("Find B2B SaaS companies");
  assertEquals(base.company_profile.stages, []);
  const m = { ...base, required_capabilities: ["startup_company_discovery"] } as typeof base;
  const plan = buildCapabilityGraph(m, V2);
  const startupRow = plan.entry_selection!.considered.find((c) => c.capability === "startup_company_discovery")!;
  assertFalse(startupRow.applies, "refused: its only READY actor is out of cohort");
  assertFalse(plan.allowed_providers.includes("apify_yc_companies_memo23"));
});

Deno.test("a Company Brain stage PREFERENCE does not choose startup-cohort discovery; a stated stage still does", () => {
  // 2026-09-23 (local): "Find 1 software development company in Germany with
  // 51 to 200 employees" entered through the YC directory because the
  // workspace Brain lists seed and Series A. The Brain filled the empty stage
  // field (provenance `company_brain`) — a ranking preference, not a request.
  const base = parseLeadMissionDeterministic("Find 1 software development company in Germany with 51 to 200 employees.");
  const brain = mergeCompanyBrainIntoMission(base, { stages: ["seed", "series_a"] } as never).mission;
  assertEquals(brain.company_profile.stages, ["seed", "series_a"]);
  assertEquals(brain.field_provenance?.["company_profile.stages"], "company_brain");
  const viaBrain = buildCapabilityGraph(brain, PROBE);
  assertEquals(viaBrain.entry_capability, "general_company_discovery", "a preference ranks; it does not pick the universe");
  assertFalse(viaBrain.entry_selection!.considered.some((c) => c.capability === "startup_company_discovery" && c.applies));

  // The same stage, stated by the user, still selects the startup cohort.
  const stated = {
    ...base, company_profile: { ...base.company_profile, stages: ["seed"] },
    field_provenance: { ...base.field_provenance, "company_profile.stages": "explicit_user_request" as const },
  };
  assertEquals(buildCapabilityGraph(stated, PROBE).entry_capability, "startup_company_discovery");
  assertEquals(buildCapabilityGraph(parseLeadMissionDeterministic("Find startups in Germany"), PROBE).entry_capability,
    "startup_company_discovery");
});
