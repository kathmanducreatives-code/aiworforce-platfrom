// NO SPEND WITHOUT A PROVEN PLAN.
//
// Built from TEST task e8abeb8f-9503-4dfe-84cc-cfcbc6a416d4 (plan
// c8243321-46cb-4b76-ae33-72570150e6ea), which bought five harvestapi people
// searches for companies found on a LinkedIn JOB board, on a mission whose only
// approved discovery source was memo23.
//
// Every containment guard was deployed and running. None fired, because all of
// them were conditioned on a mission being present and the plan step carried an
// 18-field `tool_input` with no `lead_mission`. An absent mission was read as
// "old task, be permissive" when it actually meant "we do not know what we are
// about to buy".
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  PaidExecutionBlockedError, assertPaidExecutionAllowed, assertPeopleProviderAllowed,
  buildPaidExecutionPreflight, peopleProviderBlocked, preflightDryRun,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  compileFirstProviderCall, newExecutionState, runCapabilityPlan, stateMatchesMission,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(CANONICAL);

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/** The five people-search Actors that actually ran, verbatim from tool_calls. */
const ACTUALLY_BOUGHT = [
  "domain:semianalysis.com", "domain:outreach.ai", "domain:vanta.com",
  "domain:harmonic.security", "domain:unity3d.com",
];

// ══════════════════════════════════ 1. the absent mission is the root cause ══

Deno.test("1. a task with no mission is REFUSED, not treated permissively", () => {
  // The exact shape of the failed plan step: tool_input present, lead_mission absent.
  const p = buildPaidExecutionPreflight({ mission: null, plan: null });
  assertFalse(p.ok);
  assertEquals(p.mission_authority, "none");
  assert(p.blocked.some((b) => b.code === "missing_mission"));

  const err = assertThrows(
    () => assertPaidExecutionAllowed(p), PaidExecutionBlockedError);
  assertEquals((err as PaidExecutionBlockedError).code, "missing_mission");
});

Deno.test("1b. the canonical mission PASSES preflight with memo23 first", () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const first = compileFirstProviderCall(plan);

  assertEquals(first.provider, "apify_yc_companies_memo23");
  assert(first.compiled?.ok, "the memo23 input must compile");

  const p = buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: first.provider,
    firstProviderInput: first.compiled!.ok ? first.compiled!.input : null,
    firstProviderCompileOk: first.compiled!.ok,
  });
  assertEquals(p.blocked, []);
  assert(p.ok);
  assertEquals(p.mission_authority, "lead_mission_v1");
  assertEquals(p.entry_capability, "startup_company_discovery");
  assertEquals(p.first_capability, "startup_company_discovery");
  assertEquals(p.ordered_capabilities[0], "startup_company_discovery");
  assert(p.estimated_cost_units > 0);
  // Never throws for a good plan.
  assertPaidExecutionAllowed(p);
});

// ═════════════════════════════ 2. wrong first Actor fails BEFORE spending ══

Deno.test("2. a wrong first provider hard-fails before any credit is spent", () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);

  // Each of these is an Actor the failed task actually paid for.
  for (const wrong of ["apify_jobs", "apify_people_search", "apify_linkedin_company_search"]) {
    const p = buildPaidExecutionPreflight({
      mission: m, plan, firstProvider: wrong, firstProviderCompileOk: true,
    });
    assertFalse(p.ok, `${wrong} must not be an acceptable first provider`);
    const err = assertThrows(
      () => assertPaidExecutionAllowed(p), PaidExecutionBlockedError, wrong);
    // It is refused for BOTH reasons: it may not open this capability, and it
    // is not memo23.
    //
    // `apify_linkedin_company_search` is now DECLARED for
    // startup_company_discovery as a breadth source, so "not in the capability"
    // no longer fires for it. `provider_not_capability_primary` is what refuses
    // it here, and refuses it for the reason that matters: a breadth or
    // fallback source may not be the FIRST paid call. Membership stopped being
    // sufficient the moment a capability declared more than primary+fallback.
    const codes = p.blocked.map((b) => b.code);
    assert(
      codes.includes("provider_not_in_capability") ||
      codes.includes("provider_not_capability_primary") ||
      codes.includes("provider_not_in_plan"),
      `${wrong} must be refused as an opening call: ${codes.join(", ")}`,
    );
    assert(codes.includes("startup_mission_requires_memo23"));
    assert(err instanceof PaidExecutionBlockedError);
  }
});

Deno.test("2b. a startup mission entering anywhere but startup discovery is refused", () => {
  const m = mission();
  const jobPlan = buildCapabilityGraph(
    parseLeadMissionDeterministic("Find 100 Sales Operations jobs in the United States"));
  // A startup MISSION handed a job-discovery PLAN: the exact mismatch that would
  // let a job board run first.
  const p = buildPaidExecutionPreflight({
    mission: m, plan: jobPlan, firstProvider: "apify_jobs", firstProviderCompileOk: true,
  });
  assertFalse(p.ok);
  assert(p.blocked.some((b) => b.code === "startup_mission_requires_memo23"));
});

Deno.test("2c. an input that fails validation blocks the call", () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  // The failed task's memo23 call was rejected by Apify with
  // `apify_input_schema_error` and the run carried on as if it had simply
  // returned nothing. An invalid input is not an empty result.
  const p = buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: "apify_yc_companies_memo23",
    firstProviderCompileOk: false,
    firstProviderErrors: ["minEmployeeSize: \"1+\" is not a verified value"],
  });
  assertFalse(p.ok);
  assert(p.blocked.some((b) => b.code === "input_validation_failed"));
  assertThrows(() => assertPaidExecutionAllowed(p), PaidExecutionBlockedError);
});

// ══════════════════════════ 3. no people search before qualification ══

Deno.test("3. people providers are impossible until the whole company chain passes", () => {
  // Nothing done yet — exactly where the failed task was when it bought people.
  for (const provider of ["apify_people_search", "apify_linkedin_company_employees"]) {
    const r = peopleProviderBlocked(provider, {
      completed_capabilities: [], qualified_company_keys: [],
    });
    assert(r.blocked, `${provider} must be blocked with nothing completed`);
    assertThrows(
      () => assertPeopleProviderAllowed(provider, {
        completed_capabilities: [], qualified_company_keys: [],
      }),
      PaidExecutionBlockedError,
    );
  }

  // Each prerequisite alone is not enough.
  const chain = [
    "company_identity_resolution", "company_enrichment",
    "hiring_verification", "company_brain_qualification",
  ] as const;
  for (let i = 1; i < chain.length; i++) {
    const r = peopleProviderBlocked("apify_people_search", {
      completed_capabilities: chain.slice(0, i), qualified_company_keys: ["a"],
    });
    assert(r.blocked, `partial chain (${i}/4) must still block`);
  }

  // Full chain but ZERO qualified companies — the failed task's exact position.
  const noneQualified = peopleProviderBlocked("apify_people_search", {
    completed_capabilities: [...chain], qualified_company_keys: [],
  });
  assert(noneQualified.blocked);
  assert(noneQualified.reason.includes("Company Brain pass"));

  // Full chain AND a qualified company → allowed.
  const allowed = peopleProviderBlocked("apify_people_search", {
    completed_capabilities: [...chain], qualified_company_keys: ["domain:sortly.com"],
  });
  assertFalse(allowed.blocked);
});

Deno.test("3b. the engine itself refuses founder discovery with nothing qualified", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  // memo23 returns a company, but enrichment yields no usable evidence, so the
  // Brain cannot qualify anything. Founder discovery must NOT be reachable.
  const calls: string[] = [];
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (c: CompiledActorCall<unknown>) => {
      calls.push(c.actorKey);
      if (c.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve([{ id: "x", name: "Acme", website: "https://acme.com", jobs: [] }]);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: false, outcome: "no_match" }),
  }, { mission: m, plan, brain: BRAIN });

  assertEquals(run.state.qualified_company_keys.length, 0);
  for (const people of ACTUALLY_BOUGHT) {
    assertFalse(calls.includes("apify_people_search"),
      `no people search may run (would have bought ${people})`);
  }
  assertFalse(calls.includes("apify_linkedin_company_employees"));
});

// ════════════════════════ 4. zero results never counts as completed ══

Deno.test("4. a capability with no usable records is NOT marked completed", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (c: CompiledActorCall<unknown>) =>
      c.actorKey === "apify_yc_companies_memo23"
        ? Promise.resolve([{ id: "x", name: "Acme", website: "https://acme.com", jobs: [] }])
        : Promise.resolve([]),          // enrichment + hiring return nothing
    verifyEmployer: () => ({ verified: false, outcome: "no_match" }),
  }, { mission: m, plan, brain: BRAIN });

  // Enrichment produced nothing, so it is NOT complete and stays pending.
  assertFalse(run.state.completed_capabilities.includes("company_enrichment"),
    "enrichment that returned nothing has not enriched anything");
  assert(run.state.pending_capabilities.includes("company_enrichment"),
    "an incomplete capability stays pending so a resume retries it");
  assertFalse(run.state.completed_capabilities.includes("company_brain_qualification"));

  // Discovery DID produce a company, so that one is genuinely complete.
  assert(run.state.completed_capabilities.includes("startup_company_discovery"));
});

// ══════════════════════════════ 5. stale state cannot cross missions ══

Deno.test("5. stale execution state cannot be reused for a different mission", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);

  // A state that claims the whole company chain is done — which, if trusted,
  // would open the people gate immediately.
  const stale = newExecutionState(plan, "hash-of-a-completely-different-mission");
  stale.completed_capabilities = [
    "startup_company_discovery", "company_identity_resolution",
    "company_enrichment", "hiring_verification", "company_brain_qualification",
  ];
  stale.qualified_company_keys = ["domain:someone-elses-company.com"];

  assertFalse(stateMatchesMission(stale, "any-other-hash"));

  const calls: string[] = [];
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (c: CompiledActorCall<unknown>) => { calls.push(c.actorKey); return Promise.resolve([]); },
    verifyEmployer: () => ({ verified: false, outcome: "no_match" }),
  }, { mission: m, plan, state: stale, brain: BRAIN });

  // The alien state was discarded: discovery ran again and nothing inherited a
  // qualified company it never earned.
  assert(calls.includes("apify_yc_companies_memo23"));
  assertEquals(run.state.qualified_company_keys, []);
  assertFalse(calls.includes("apify_people_search"),
    "a borrowed qualification must not open the people gate");
});

// ═══════════════════════ 6. the exact Actor input matches the contract ══

Deno.test("6. the first Actor input matches the capability contract exactly", () => {
  const plan = buildCapabilityGraph(mission());
  const { provider, compiled } = compileFirstProviderCall(plan, { maxCandidates: 50 });

  assertEquals(provider, "apify_yc_companies_memo23");
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  assertEquals(compiled.actorId, "memo23/y-combinator-scraper");

  const input = compiled.input as Record<string, unknown>;
  assertEquals(input.mode, "companies");
  assertEquals(input.isHiring, true);
  assertEquals(input.scrapeOpenJobs, true);
  // Founder enrichment stays OFF during broad discovery — it costs a request per
  // company for people who have not been qualified yet.
  assertEquals(input.scrapeFounderDetails, false);
  assertEquals(input.regions, ["United States of America"]);
});

// ═════════════════════════════════════════════════════ 7. the dry run ══

Deno.test("7. the dry run the UI shows is derived from the gating record", () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const first = compileFirstProviderCall(plan);
  const p = buildPaidExecutionPreflight({
    mission: m, plan, firstProvider: first.provider,
    firstProviderInput: first.compiled?.ok ? first.compiled.input : null,
    firstProviderCompileOk: first.compiled?.ok,
  });
  const dry = preflightDryRun(p);

  assertEquals(dry.mission_summary, CANONICAL);
  assertEquals(dry.first_provider, "apify_yc_companies_memo23");
  assertEquals(dry.capability_order[0], "startup_company_discovery");
  assert(dry.estimated_cost_units > 0);
  assert(dry.ok);
  assertEquals(dry.blocked_reasons, []);
  assert(dry.input_summary.includes("mode=companies"));

  // A blocked plan surfaces its reasons rather than looking runnable.
  const bad = preflightDryRun(buildPaidExecutionPreflight({ mission: null, plan: null }));
  assertFalse(bad.ok);
  assert(bad.blocked_reasons.some((r) => r.startsWith("missing_mission")));
});

// ══════════════════════════════════════ 8. the wiring at the call sites ══

Deno.test("8. run-agent gates every paid boundary on the preflight", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

  assert(src.includes("const paidPreflight = buildPaidExecutionPreflight({"),
    "the preflight must be built before paid work");
  assert(src.includes("assertPaidExecutionAllowed(paidPreflight)"),
    "and it must THROW, not warn");
  assert(src.includes("paid_execution_preflight: paidPreflight"),
    "a blocked run must still be auditable");

  // It must come BEFORE both executors.
  const gate = src.indexOf("assertPaidExecutionAllowed(paidPreflight)");
  const engine = src.indexOf("runCapabilityPlan({");
  const legacyRoute = src.indexOf("executeCompanyFirstRoute({");
  const legacyLoop = src.indexOf("executeRunAgentCompanyFirstSourcing({");
  assert(gate > 0 && engine > 0 && legacyRoute > 0 && legacyLoop > 0);
  assert(gate < engine, "the gate must precede the capability engine");
  assert(gate < legacyRoute, "the gate must precede the legacy route executor");
  assert(gate < legacyLoop, "the gate must precede the legacy sourcing loop");
});

Deno.test("8b. orchestrate can no longer emit a plan without a mission", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));
  assert(src.includes("parseLeadMissionDeterministic(user_instruction"),
    "a missing mission must be derived from the user's own sentence, not left null");
  assert(src.includes("isLeadMissionV1(suppliedMission)"),
    "a supplied mission must be structurally validated before it is trusted");
});

Deno.test("8c. the engine gates founder discovery on the people prerequisites", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assert(src.includes("assertPeopleProviderAllowed("),
    "founder discovery must consult the people gate");
  assert(src.includes("const genuinelyComplete ="),
    "completion must require satisfied evidence");
});
