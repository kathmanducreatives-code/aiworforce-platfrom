// LEAD V2 P6 — ROUTE SELECTION: THE ENTRY IS A TABLE, THE NEXT PROOF IS THE CHEAPEST OPEN ROUTE.
//
// Pins:
//   - entry selection is an ordered table, every candidate considered is
//     recorded under V2, and legacy (V1 / Signals) plans carry no record of it;
//   - named companies skip discovery; a hiring-led mission enters through the role;
//   - an entry whose actors are not live says so, in an advisory, under V2 only;
//   - a gap is routed to the CHEAPEST executable route, whatever the registry order;
//   - a target ("first in the function") schedules no paid verification.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph, entryProvidersCanRun } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { CLAIM_REGISTRY, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";

const V2 = { executability: "enforce" as const };
const mission = (q: string) => parseLeadMissionDeterministic(q);

const HIRING = mission("Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.");
const KNOWN = mission("Research stripe.com and linear.app");
const FUNDED = mission("Find recently Seed-funded companies");
const PROFILE = mission("Find B2B SaaS companies");

Deno.test("V2 records every entry considered, in order, ending at the one taken", () => {
  for (const m of [HIRING, KNOWN, FUNDED, PROFILE]) {
    const plan = buildCapabilityGraph(m, V2);
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
  assertEquals(plan.entry_selection!.readiness, "none", "resolving a named company buys no discovery actor");
});

Deno.test("a hiring-led mission enters through the role, on a READY actor, with no readiness advisory", () => {
  const plan = buildCapabilityGraph(HIRING, V2);
  assertEquals(plan.entry_capability, "job_discovery");
  assertEquals(plan.entry_selection!.readiness, "READY");
  assertFalse(plan.routing_advisories.some((a) => /Actor Intelligence/.test(a)));
  // The directory rows below it were never weighed — the table stops at the first that applies.
  assertFalse(plan.entry_selection!.considered.some((c) => c.capability === "startup_company_discovery"));
});

Deno.test("an entry whose actors were never run live says so, and is still taken", () => {
  const plan = buildCapabilityGraph(FUNDED, V2);
  assertEquals(plan.entry_capability, "funding_signal_discovery");
  assertEquals(plan.entry_selection!.readiness, "CARDED_BUT_NOT_LIVE");
  assert(plan.routing_advisories.some((a) =>
    a.includes("funding_signal_discovery") && a.includes("CARDED_BUT_NOT_LIVE") && /first live proof/.test(a)));
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

Deno.test("an entry can run only if one of its actors is READY or carded-but-not-live", () => {
  const all = (state: string) => () => state;
  assert(entryProvidersCanRun("funding_signal_discovery"), "datahyena is carded: it may run, with the advisory");
  assert(entryProvidersCanRun("funding_signal_discovery", all("READY")));
  assert(entryProvidersCanRun("funding_signal_discovery", all("CARDED_BUT_NOT_LIVE")));
  for (const s of ["NEEDS_PROVIDER_WORK", "NEEDS_EXTRACTION_WORK", "LEGACY_ONLY", "NOT_PRESENT"]) {
    assertFalse(entryProvidersCanRun("funding_signal_discovery", all(s)), s);
  }
  // one runnable provider among dead ones is enough
  assert(entryProvidersCanRun("job_discovery", (a) => a === "apify_linkedin_job_search" ? "READY" : "NOT_PRESENT"));
  assert(entryProvidersCanRun("known_company_resolution", all("NOT_PRESENT")), "a provider-less entry buys nothing and runs");
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
