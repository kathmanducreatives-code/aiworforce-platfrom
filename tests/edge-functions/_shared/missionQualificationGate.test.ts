// AN EVIDENCE-EMPTY MISSION MUST NOT BE ABLE TO SPEND.
//
// Task 44b82535 is the case these exist for. Its mission was structurally
// perfect and semantically empty: `required_signals: []`,
// `required_capabilities: []`, `directives: null`, one vertical ("b2b saas").
// The paid preflight returned `ok: true, blocked: []` and authorised 9 cost
// units of discovery and enrichment for 94 companies that no evidence could
// ever have qualified.
//
// The question these tests answer is the one that matters: can an ambiguous or
// failed LeadMission compilation still cause paid generic sourcing?
//
// ZERO network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPaidExecutionPreflight, missionQualificationContract,
  assertPaidExecutionAllowed, PaidExecutionBlockedError,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  projectEvaluationRows, readableCompanyName, looksLikeUrl,
} from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

/** The exact mission shape task 44b82535 compiled and then spent against. */
function emptyContractMission(): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(
    "Find 10 Founder their sales teams in B2B SaaS. Save them to Signal Feed.");
  return {
    ...base,
    requested_count: 10,
    requested_output: "contact_ready_leads",
    mission_type: "qualified_lead_sourcing",
    company_profile: {
      stages: [], locations: [], verticals: ["b2b saas", "saas"], business_models: [],
    },
    required_signals: [],
    required_capabilities: [],
    directives: undefined,
  } as LeadMissionV1;
}

// ══════════════════════════════ 1-3. the gate itself ══

Deno.test("1. the exact failed mission has NO qualification contract", () => {
  const c = missionQualificationContract(emptyContractMission());
  assertFalse(c.ok, "a bare vertical plus a job title is not a contract");
  assertEquals(c.sources, []);
  assert(c.detail.includes("nothing collected could decide"));
});

Deno.test("2. any real discriminator satisfies the gate", () => {
  const base = emptyContractMission();

  // A commercial signal.
  assert(missionQualificationContract({
    ...base, required_signals: [{ type: "hiring", role_families: ["sales"] }],
  }).ok);

  // An explicit evidence contract from the compiler.
  assert(missionQualificationContract({
    ...base,
    directives: {
      preferred_signals: [], adjacent_signals: [], excluded_signals: [],
      required_evidence: ["open_sales_role"], disallowed_broadening: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      evaluation_instructions: "", source_strategy: [],
      requested_contact_ready_count: null, founder_unlock_recommended: false,
    },
  } as LeadMissionV1).ok);

  // NAMED COMPANIES NEED NO SIGNAL AT ALL. "Is it one of these?" is complete.
  assert(missionQualificationContract({
    ...base,
    company_profile: { ...base.company_profile, known_companies: ["stripe.com"] },
  }).ok, "an explicit company list is its own qualification contract");
});

Deno.test("3. non-qualifying missions are not subject to the gate", () => {
  const base = emptyContractMission();
  // Job research asks a different question and needs no qualification contract.
  const plan = buildCapabilityGraph(base);
  const pf = buildPaidExecutionPreflight({
    mission: { ...base, mission_type: "job_research", requested_output: "job_listings" },
    plan, firstProvider: plan.allowed_providers[0], firstProviderCompileOk: true,
  });
  assertFalse(pf.blocked.some((b) => b.code === "mission_lacks_qualification_contract"));
});

// ════════════════════════ 4-6. no paid execution, proven ══

Deno.test("4. the failed mission is now BLOCKED before any provider call", () => {
  const mission = emptyContractMission();
  const plan = buildCapabilityGraph(mission);
  const pf = buildPaidExecutionPreflight({
    mission, plan,
    firstProvider: plan.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
  });

  assertFalse(pf.ok, "this preflight returned ok:true in production and cost 9 units");
  assert(pf.blocked.some((b) => b.code === "mission_lacks_qualification_contract"));
});

Deno.test("5. the block is enforced, not merely recorded", () => {
  const mission = emptyContractMission();
  const plan = buildCapabilityGraph(mission);
  const pf = buildPaidExecutionPreflight({
    mission, plan, firstProvider: plan.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
  });

  let threw: PaidExecutionBlockedError | null = null;
  try { assertPaidExecutionAllowed(pf); } catch (e) { threw = e as PaidExecutionBlockedError; }
  assert(threw, "a blocked preflight must throw before the first paid call");
  assertEquals(threw!.name, "PaidExecutionBlockedError");
});

Deno.test("6. an ambiguous query cannot buy generic sourcing — the whole point", () => {
  // Several differently-worded ambiguous lead requests, none naming a signal.
  // No phrase from the original query is hardcoded anywhere in the fix.
  for (const q of [
    "Find 10 Founder their sales teams in B2B SaaS.",
    "Get me 25 fintech companies.",
    "I need 50 marketing agencies please.",
    "Find 15 CEOs at healthcare startups.",
  ]) {
    const base = parseLeadMissionDeterministic(q);
    const mission: LeadMissionV1 = {
      ...base, mission_type: "qualified_lead_sourcing",
      requested_output: "contact_ready_leads",
      required_signals: [], required_capabilities: [], directives: undefined,
    };
    if (missionQualificationContract(mission).ok) continue; // already discriminating
    const plan = buildCapabilityGraph(mission);
    const pf = buildPaidExecutionPreflight({
      mission, plan, firstProvider: plan.allowed_providers[0] ?? null,
      firstProviderCompileOk: true,
    });
    assertFalse(pf.ok, `"${q}" must not be allowed to spend`);
  }
});

// ═══════════════ 7-8. hiring is inferred, never mandatory ══

Deno.test("7. a hiring query schedules hiring evidence; a non-hiring one does not", () => {
  const hiring = parseLeadMissionDeterministic(
    "Find 10 founders at B2B SaaS companies that are hiring their first sales reps. Return 10 leads.");
  assert(hiring.required_signals.some((s) => s.type === "hiring"),
    "an explicit hiring verb must produce a hiring signal");
  assert(missionQualificationContract(hiring).ok, "and therefore a contract");
  const hiringPlan = buildCapabilityGraph(hiring);
  assert(
    hiringPlan.steps.some((s) =>
      String(s.capability) === "hiring_verification" ||
      String(s.capability) === "job_discovery"),
    "hiring evidence must be scheduled at CAPABILITY level");

  // A named-company enrichment mission must NOT acquire hiring capabilities.
  const generic = parseLeadMissionDeterministic(
    "Enrich these companies: stripe.com, notion.so");
  const genericPlan = buildCapabilityGraph(generic);
  assertFalse(
    genericPlan.steps.some((s) => String(s.capability) === "hiring_verification"),
    "hiring must not be forced onto a mission that never asked for it");
});

Deno.test("8. the gate names no Actor and no provider", async () => {
  const src = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts", import.meta.url));
  // Bounded to the function itself — the pre-existing startup route rule below
  // it names an Actor legitimately and is not what this asserts about.
  const start = src.indexOf("export function missionQualificationContract");
  assert(start > 0, "the gate exists");
  const gate = src.slice(start, src.indexOf("\n}", start) + 2);

  for (const banned of ["apify_", "memo23", "harvestapi", "solidcode", "crawlworks"]) {
    assertFalse(gate.includes(banned), `the gate must not mention ${banned}`);
  }
  // It decides from the MISSION, never from a provider or a hardcoded phrase.
  for (const phrase of ["sales team", "b2b saas", "founder their", "abr-talent"]) {
    assertFalse(gate.toLowerCase().includes(phrase),
      `the gate must not hardcode "${phrase}"`);
  }
  // The whole point: it is query-generic.
  assert(gate.includes("required_signals") && gate.includes("known_companies"),
    "the gate reads mission fields");
});

// ═════════════════ 9-11. company_name normalization ══

Deno.test("9. a LinkedIn URL can never survive as company_name", () => {
  assert(looksLikeUrl("https://www.linkedin.com/company/abr-talent"));
  assert(looksLikeUrl("www.example.com"));
  assertFalse(looksLikeUrl("Abr Talent"));

  // The exact production value.
  const key = "https://www.linkedin.com/company/abr-talent";
  const name = readableCompanyName({ key });
  assertFalse(looksLikeUrl(name), "a URL must never be returned as a name");
  assertEquals(name, "Abr Talent", "the slug is the last resort, not the URL");

  // AUTHORITATIVE PROVIDER FIELDS WIN. No slug invention when a real name exists.
  assertEquals(
    readableCompanyName({ authoritative: "ABR Talent Ltd", prequalified: "Other", key }),
    "ABR Talent Ltd");
  assertEquals(readableCompanyName({ prequalified: "Prequal Name", key }), "Prequal Name");
  // A URL in an authoritative slot is still refused.
  assertEquals(readableCompanyName({ authoritative: key, key }), "Abr Talent");
  // Nothing at all is null, never a URL.
  assertEquals(readableCompanyName({ key: "https://x.io/" }), null);
});

Deno.test("10-11. the projection carries enrichment through, and never a URL", () => {
  const key = "https://www.linkedin.com/company/abr-talent";
  const out = projectEvaluationRows([{
    key, shortlisted: false, prequalified: null,
    identityResolved: true, identityAttempted: true,
    enriched: true, hiringVerified: false, verdict: null, contactCount: 0,
    // What the failed run had bought but never read.
    companyName: "ABR Talent", employeeCount: 42,
  }]);

  assertEquals(out.rows.length, 1);
  assertEquals(out.rows[0].company_name, "ABR Talent");
  assertFalse(looksLikeUrl(out.rows[0].company_name));
  // 11. Enrichment reaches the Workbench. This was null for all 94 rows.
  assertEquals(out.rows[0].employee_count, 42);
  // The URL still lives in the key, which is its correct home.
  assertEquals(out.rows[0].company_key, key);
});
