// THE COMPILED INPUT IS THE INPUT THAT GETS SENT.
//
// TEST task e8abeb8f-9503-4dfe-84cc-cfcbc6a416d4 failed memo23 with
//
//   apify_message: "Input is not valid: Field input.location must be string"
//   payload_keys:  ["query", "location", "role_keywords", "max_results"]
//   source_type:   "jobs"
//
// Those are NOT memo23 fields. The compiled Companies-mode payload never reached
// Apify: run-agent spread `call.input` at the TOP level of the runTool envelope,
// but `runTool` only honours a pre-compiled payload when it arrives as
// `user_input` alongside `compiled_actor_input: true`. Without the flag it looked
// up an input adapter by actor_id, found none for memo23/y-combinator-scraper,
// and synthesised a generic jobs payload instead.
//
// This is the SAME defect `finalActorPayload.ts` documents for production task
// 2425ec4f (Crawlworks). The passthrough contract already existed; the capability
// engine was not using it.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileMemo23YcInput, compileSolidcodeYcInput, fanOutSolidcodeTeamSizes,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  YC_MEMO23_INDUSTRIES, YC_MEMO23_MAX_SIZES, YC_MEMO23_MIN_SIZES, YC_MEMO23_MODES,
  YC_SOLIDCODE_TEAM_SIZES,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  MEMO23_DEFAULT_MAX_SIZE, MEMO23_DEFAULT_MIN_SIZE, compileFirstProviderCall,
  runCapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const mission = () => parseLeadMissionDeterministic(CANONICAL);
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/** The payload Apify actually received on the failed run. */
const REJECTED_PAYLOAD_KEYS = ["query", "location", "role_keywords", "max_results"];

// ═════════════════════════════ 1/2. the failure and the corrected input ══

Deno.test("1. the rejected payload is a JOBS payload, not a memo23 payload", () => {
  const { compiled } = compileFirstProviderCall(buildCapabilityGraph(mission()));
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  const keys = Object.keys(compiled.input as Record<string, unknown>);

  // None of the rejected keys belong to the Companies-mode contract.
  for (const k of REJECTED_PAYLOAD_KEYS) {
    assertFalse(keys.includes(k),
      `"${k}" is a jobs-serializer field and must never appear in a memo23 payload`);
  }
  // `location` in particular is the field Apify named. memo23 uses `regions`.
  assertFalse(keys.includes("location"));
  assert(keys.includes("regions"));
});

Deno.test("2. the corrected canonical input validates", () => {
  const { provider, compiled } = compileFirstProviderCall(
    buildCapabilityGraph(mission()), { maxCandidates: 100 });
  assertEquals(provider, "apify_yc_companies_memo23");
  assert(compiled?.ok, "the corrected input must compile");
  if (!compiled?.ok) return;

  const i = compiled.input as Record<string, unknown>;
  assertEquals(compiled.actorId, "memo23/y-combinator-scraper");
  assertEquals(i.mode, "companies");
  assertEquals(i.queries, []);
  assertEquals(i.topCompany, false);
  assertEquals(i.nonprofit, false);
  assertEquals(i.batch, ["All Batches"]);
  assertEquals(i.isHiring, true);
  assertEquals(i.scrapeOpenJobs, true);
  assertEquals(i.scrapeFounderDetails, false);
  assertEquals(i.enrichEmails, false);
  assertEquals(i.maxItems, 100);
});

Deno.test("3. the region is exactly \"United States of America\"", () => {
  const { compiled } = compileFirstProviderCall(buildCapabilityGraph(mission()));
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  assertEquals((compiled.input as Record<string, unknown>).regions, ["United States of America"]);
});

// ═══════════════════════════════════ 4/5/6/7. shape discipline ══

Deno.test("4. Companies mode never carries Jobs-mode fields", () => {
  const { compiled } = compileFirstProviderCall(buildCapabilityGraph(mission()));
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  const keys = Object.keys(compiled.input as Record<string, unknown>);
  // `role` and `location` are the Jobs-mode selectors on this Actor.
  for (const jobsOnly of ["role", "location"]) {
    assertFalse(keys.includes(jobsOnly), `${jobsOnly} is Jobs-mode only`);
  }
});

Deno.test("5. startUrls is never emitted, so guided filters cannot be overridden", () => {
  const { compiled } = compileFirstProviderCall(buildCapabilityGraph(mission()));
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  const i = compiled.input as Record<string, unknown>;
  assertFalse("startUrls" in i,
    "a non-empty startUrls makes the Actor ignore every guided filter");
});

Deno.test("6/7. unsupported values are rejected and nothing is null/undefined", () => {
  // Unsupported enum values are refused by the compiler, not sent.
  const badMode = compileMemo23YcInput({ mode: "people" as never, maxItems: 10 });
  assertFalse(badMode.ok);
  const badIndustry = compileMemo23YcInput({
    mode: "companies", industries: ["SaaS"], maxItems: 10,
  });
  assertFalse(badIndustry.ok, "\"SaaS\" is not a memo23 industry — \"B2B\" is");
  const badMin = compileMemo23YcInput({
    mode: "companies", minEmployeeSize: "10", maxItems: 10,
  });
  assertFalse(badMin.ok, "min sizes carry a trailing +");

  // And the emitted payload serializes with no null/undefined values.
  const { compiled } = compileFirstProviderCall(buildCapabilityGraph(mission()));
  assert(compiled?.ok);
  if (!compiled?.ok) return;
  const round = JSON.parse(JSON.stringify(compiled.input)) as Record<string, unknown>;
  for (const [k, v] of Object.entries(round)) {
    assert(v !== null && v !== undefined, `${k} must not serialize as ${String(v)}`);
  }
});

// ══════════════════════════════ 8/9/10. size bounds and hiring semantics ══

Deno.test("8. employee bounds use supported enum values only", () => {
  assert(YC_MEMO23_MIN_SIZES.includes(MEMO23_DEFAULT_MIN_SIZE as never),
    `${MEMO23_DEFAULT_MIN_SIZE} must be a pinned min-size enum`);
  assert(YC_MEMO23_MAX_SIZES.includes(MEMO23_DEFAULT_MAX_SIZE as never),
    `${MEMO23_DEFAULT_MAX_SIZE} must be a pinned max-size enum`);
  assertEquals(MEMO23_DEFAULT_MIN_SIZE, "10+");
  assertEquals(MEMO23_DEFAULT_MAX_SIZE, "500");
  // 150 is NOT an option, which is why discovery casts broad.
  assertFalse(YC_MEMO23_MAX_SIZES.includes("150" as never));
  assert(YC_MEMO23_MODES.includes("companies"));
  assert(YC_MEMO23_INDUSTRIES.includes("B2B"));
});

Deno.test("9. the real 10-150 bound is enforced AFTER enrichment, not by the Actor", async () => {
  // THE BOUND NOW COMES FROM THE MISSION, NOT THE WORKSPACE BRAIN.
  //
  // This test's point is unchanged: the ENRICHED headcount (400) decides, not
  // YC's self-reported 40. What changed is whose 10-150 it is. A workspace
  // Brain may no longer reject on an axis the Mission never mentioned — see
  // `missionQualificationContext` and the companion test below — so the range
  // is stated on the Mission, which is where an enforceable bound belongs.
  const base = mission();
  const m = {
    ...base,
    company_profile: { ...base.company_profile, employee_range: { min: 10, max: 150 } },
  } as typeof base;
  const plan = buildCapabilityGraph(m);
  // A YC company whose ENRICHED headcount is 400 — inside the broad 10+..500
  // discovery filter, outside the mission's 10-150.
  const run = await runCapabilityPlan({
    invoke: (c: CompiledActorCall<unknown>) => {
      if (c.actorKey === "apify_yc_companies_memo23") {
        // YC SELF-REPORTS 40. LinkedIn says 400.
        //
        // That gap is the point of the test and the reason `teamSize` is marked
        // `unsafe` in the normalizer: the free prequalification gate reads the
        // self-reported number (40 — inside 10-150, so the company is correctly
        // worth paying to identify), and the ENRICHED count is what actually
        // decides. A fixture with no size at all could never show that, because
        // an unverified size never reaches enrichment in the first place.
        return Promise.resolve([{
          id: "big", name: "BigCo", website: "https://bigco.com", teamSize: 40,
          openJobs: [{ title: "Revenue Operations Manager", url: "https://x/big/1" }],
        }]);
      }
      if (c.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve([{ id: "big", name: "BigCo",
          linkedinUrl: "https://www.linkedin.com/company/bigco",
          website: "https://bigco.com" }]);
      }
      if (c.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve([{ id: "big", name: "BigCo",
          linkedinUrl: "https://www.linkedin.com/company/bigco",
          website: "https://bigco.com", employeeCount: 400,
          description: "BigCo is a B2B SaaS platform sold on subscription.",
          industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
          locations: [{ linkedinText: "United States" }] }]);
      }
      if (c.actorKey === "apify_linkedin_job_search") {
        // Real hiring evidence, so the company genuinely reaches qualification
        // and is rejected on SIZE rather than stalling earlier.
        return Promise.resolve([{ id: "j1", title: "Revenue Operations Manager",
          company: { name: "BigCo", linkedinUrl: "https://www.linkedin.com/company/bigco" },
          postedDate: "2026-07-20" }]);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  }, { mission: m, plan, brain: BRAIN });

  assertEquals(run.state.qualified_company_keys.length, 0,
    "400 employees is outside 10-150 and must be rejected from ENRICHED evidence");
  const rejected = run.companies.find((c) => c.verdict === "reject");
  assert(rejected, "the company must be explicitly rejected");
  assert(rejected!.fit?.failed_gates.includes("employee_count_above_max"));
});

Deno.test("9b. a Brain-only size bound does NOT reject when the Mission is silent", async () => {
  // THE AUTHORITY RULE, EXERCISED END TO END.
  //
  // Identical fixture to test 9 — a 400-employee company under a 10-150 Brain —
  // except the Mission states no employee range. TEST run cf6cce3d excluded 7
  // companies exactly this way, on a question the user never asked. The Brain's
  // bound survives for RANKING; it may not reject.
  const m = mission();
  assertEquals((m.company_profile as { employee_range?: unknown }).employee_range, undefined,
    "the fixture Mission must genuinely express no size opinion");
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    invoke: (c: CompiledActorCall<unknown>) => {
      if (c.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve([{
          id: "big", name: "BigCo", website: "https://bigco.com", teamSize: 40,
          openJobs: [{ title: "Revenue Operations Manager", url: "https://x/big/1" }],
        }]);
      }
      if (c.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve([{ id: "big", name: "BigCo",
          linkedinUrl: "https://www.linkedin.com/company/bigco",
          website: "https://bigco.com" }]);
      }
      if (c.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve([{ id: "big", name: "BigCo",
          linkedinUrl: "https://www.linkedin.com/company/bigco",
          website: "https://bigco.com", employeeCount: 400,
          description: "BigCo is a B2B SaaS platform sold on subscription.",
          industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
          locations: [{ linkedinText: "United States" }] }]);
      }
      if (c.actorKey === "apify_linkedin_job_search") {
        return Promise.resolve([{ id: "j1", title: "Revenue Operations Manager",
          company: { name: "BigCo", linkedinUrl: "https://www.linkedin.com/company/bigco" },
          postedDate: "2026-07-20" }]);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  }, { mission: m, plan, brain: BRAIN });

  const co = run.companies.find((c) => c.key.includes("bigco") || c.company.company_name === "BigCo");
  assert(co, "the company must still be evaluated");
  assertFalse(
    co!.fit?.failed_gates.includes("employee_count_above_max") ?? false,
    "a Brain-only bound must not fail the size gate when the Mission set none",
  );
});

Deno.test("10. YC isHiring is not treated as Sales-Ops verification", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  // isHiring=true at YC, but NO matching open role anywhere.
  const run = await runCapabilityPlan({
    invoke: (c: CompiledActorCall<unknown>) => {
      if (c.actorKey === "apify_yc_companies_memo23") {
        // Generic hiring only — a backend engineer, not a commercial role.
        return Promise.resolve([{ id: "a", name: "Acme", website: "https://acme.com",
          isHiring: true, jobs: [{ title: "Backend Engineer", url: "https://x/9" }] }]);
      }
      if (c.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve([{ id: "a", name: "Acme",
          linkedinUrl: "https://www.linkedin.com/company/acme",
          website: "https://acme.com", employeeCount: 50,
          description: "Acme is a B2B SaaS platform.",
          industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
          locations: [{ linkedinText: "United States" }] }]);
      }
      return Promise.resolve([]);           // job search finds nothing either
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  }, { mission: m, plan, brain: BRAIN });

  assertEquals(run.state.qualified_company_keys.length, 0,
    "a generic YC isHiring flag must not stand in for a verified commercial role");
  assertFalse(run.state.completed_capabilities.includes("hiring_verification"));
});

// ══════════════════════ 11/12/13. a schema failure stops everything ══

Deno.test("11/12. a schema failure stops before every paid fallback", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const calls: string[] = [];
  // Force the compiler to reject by supplying an unsupported region.
  const run = await runCapabilityPlan({
    invoke: (c: CompiledActorCall<unknown>) => { calls.push(c.actorKey); return Promise.resolve([]); },
    verifyEmployer: () => ({ verified: false, outcome: "no" }),
  }, {
    mission: m, plan, brain: BRAIN,
    ycIndustries: ["NotARealIndustry"],       // compiler rejects this
    solidcodeTeamSizes: ["2-10"],
  });

  assertEquals(run.state.terminal_reason, "provider_input_validation_failed");
  assertFalse(calls.includes("apify_yc_companies_memo23"),
    "an input that fails validation is never sent");
  // No fallback of any kind ran — not solidcode, and certainly not a job board.
  assertFalse(calls.includes("apify_yc_companies_solidcode"));
  for (const job of ["apify_jobs", "apify_indeed_jobs_automation_lab", "apify_glassdoor_jobs"]) {
    assertFalse(calls.includes(job), `${job} must not run after a schema failure`);
  }
  assertFalse(calls.includes("apify_people_search"));
  assertFalse(calls.includes("apify_linkedin_company_employees"));
  // And discovery is NOT marked complete.
  assertFalse(run.state.completed_capabilities.includes("startup_company_discovery"));
});

Deno.test("13. run-agent sends the compiled input through the passthrough contract", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("compiled_actor_input: true"),
    "the compiled payload must be marked authoritative");
  // CORRECTED. This previously asserted `user_input`, which `runTool` does NOT
  // read at the envelope level — so the assertion passed while the payload was
  // dropped and `{}` went to Apify. Asserting the sender's shape against a
  // receiver contract that was never checked is what let runs rWikfnKgnp5DazDYr
  // and eGzD7gzJNGFm4c4IZ happen. The HTTP body itself is now asserted in
  // `apifyTransportIntegrity.test.ts`.
  assert(src.includes("input: call.input as Record<string, unknown>"),
    "it must travel as `input` — the key toolRegistry actually reads");
  assertFalse(src.includes("user_input: call.input"),
    "the user_input key is the defect and must not return");
  assert(src.includes("capability_key: call.actorKey"),
    "the capability must be named so the final-payload validator can check it");
  // The defective top-level spread must not return.
  assertFalse(/actor_id: call\.actorId,\s*\n\s*\.\.\.\(call\.input/.test(src),
    "spreading the compiled input at the top level is the defect and must not return");
});

// ═══════════════════════════════════ 14. SolidCode has its own contract ══

Deno.test("14. the SolidCode fallback uses its OWN schema, not memo23's", () => {
  // memo23 field names must be rejected by the SolidCode compiler.
  const wrong = compileSolidcodeYcInput({
    regions: ["United States of America"],
    industries: ["B2B"],
    minEmployeeSize: "10+",                    // memo23 field — not SolidCode's
    maxResults: 10,
  } as never);
  // Either it refuses outright, or it never emits the foreign field.
  if (wrong.ok) {
    assertFalse("minEmployeeSize" in (wrong.input as Record<string, unknown>),
      "a memo23 field must never be forwarded to SolidCode");
  }

  // SolidCode's own team-size bands, fanned out one per call.
  const band = YC_SOLIDCODE_TEAM_SIZES[0];
  const calls = fanOutSolidcodeTeamSizes(
    { regions: ["United States of America"], industries: ["B2B"], isHiring: true,
      includeJobs: true, includeFounders: false, maxResults: 25 },
    [band],
  );
  assertEquals(calls.length, 1);
  assert(calls[0].ok);
  if (!calls[0].ok) return;
  assertEquals(calls[0].actorId, "solidcode/ycombinator-scraper");
  const i = calls[0].input as Record<string, unknown>;
  assertEquals(i.teamSize, [band]);
  assertEquals(i.includeFounders, false, "no founder enrichment during discovery");
  assertFalse("minEmployeeSize" in i);
  assertFalse("maxEmployeeSize" in i);
  assertFalse("batch" in i, "batch is a memo23 field");
});

// ═════════════════ 15. the dry run and the real input are the same bytes ══

Deno.test("15. the dry-run preview and the compiled input are byte-equivalent", () => {
  const plan = buildCapabilityGraph(mission());
  const a = compileFirstProviderCall(plan, { maxCandidates: 100 });
  const b = compileFirstProviderCall(plan, { maxCandidates: 100 });
  assert(a.compiled?.ok && b.compiled?.ok);
  if (!a.compiled?.ok || !b.compiled?.ok) return;

  // Deterministic: the preview compiles the same call the engine will.
  assertEquals(JSON.stringify(a.compiled.input), JSON.stringify(b.compiled.input));
  assertEquals(a.compiled.inputHash, b.compiled.inputHash);
  assertEquals(a.provider, b.provider);
});
