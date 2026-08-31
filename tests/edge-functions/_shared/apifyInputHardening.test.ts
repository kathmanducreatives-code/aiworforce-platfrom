// THREE BOUNDARIES BETWEEN A MISSION AND A PAID APIFY CALL.
//
// From the 2026-08-31 input audit:
//
//   R2  `validateFinalActorPayload` had rules for five JOB capabilities. Every
//       company-side capability — search, details, employees, posts, funding,
//       news, technology, YC — returned `ok: true` unconditionally, so the last
//       gate before a paid POST asserted nothing about the calls that spend most
//       of the money.
//
//   R1  Discovery input was assembled by object spread, and spread REPLACES: a
//       strategy naming `industryIds` discarded the mission's industries rather
//       than refining them, which is the opposite of the comment beside it.
//       `maxItems` was set twice and the later one silently won.
//
//   R3  Three fingerprints, two of them 32-bit, none including the actor:
//       FNV-1a (compiled_input_hash -> logical_call_key -> credit idempotency),
//       djb2 (completed_operations, the record that stops a resume re-buying),
//       SHA-256 (the planner). A collision does not corrupt a row — it silently
//       skips a paid call, or charges for one that should have collided.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateFinalActorPayload,
} from "../../../supabase/functions/_shared/finalActorPayload.ts";
import {
  ACTOR_INPUT_CONTRACTS,
} from "../../../supabase/functions/_shared/actorInputContracts.ts";
import {
  mergeDiscoveryActorInput, DISCOVERY_MERGE_POLICY,
} from "../../../supabase/functions/_shared/discoveryInputMerge.ts";
import {
  providerInputFingerprint, canonicalJson, sha256Hex, legacyDjb2Fingerprint,
  isV2Fingerprint,
} from "../../../supabase/functions/_shared/providerInputFingerprint.ts";
import {
  compileHarvestCompanySearchInput, hashInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  providerOperationKey, inputFingerprint, inputFingerprintV2,
  shouldSkipProviderCall, type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

// ══ 1. FINAL VALIDATION ═══════════════════════════════════════════════════

/** The three payloads production actually sent, read from `lead_execution_calls`. */
const REAL: Array<[string, Record<string, unknown>]> = [
  ["apify_linkedin_company_search",
   { maxItems: 50, companySize: ["1-10", "11-50", "51-200"],
     industryIds: ["104", "137"], scraperMode: "full" }],
  ["apify_linkedin_company_details",
   { companies: ["https://www.linkedin.com/company/letsremotivate"] }],
  ["apify_linkedin_job_search",
   { company: ["https://www.linkedin.com/company/ringside-talent"],
     maxItems: 20, jobTitles: ["sales roles", "sdr", "account executive"] }],
];

Deno.test("REAL PRODUCTION PAYLOADS STILL PASS", () => {
  // Hardening that rejects what production legitimately sends is an outage.
  for (const [cap, payload] of REAL) {
    const v = validateFinalActorPayload(cap, payload);
    assertEquals(v.ok, true, `${cap}: ${JSON.stringify(v.violations)}`);
  }
});

Deno.test("EVERY CONTRACTED CAPABILITY IS COVERED — and a new one fails here", () => {
  // The guard that stops this regressing: add a paid actor to
  // ACTOR_INPUT_CONTRACTS without validation and this test fails.
  const uncovered: string[] = [];
  for (const cap of Object.keys(ACTOR_INPUT_CONTRACTS)) {
    // A payload with a key the contract cannot know must be refused, which is
    // only possible if this capability is actually validated.
    const v = validateFinalActorPayload(cap, { __not_a_real_field__: 1 });
    if (v.ok) uncovered.push(cap);
  }
  assertEquals(uncovered, [], `capabilities with no final validation: ${uncovered.join(", ")}`);
  assert(Object.keys(ACTOR_INPUT_CONTRACTS).length >= 14,
    "the contract registry should still hold every audited actor");
});

Deno.test("a top-level ARRAY is refused for every capability", () => {
  for (const cap of [...Object.keys(ACTOR_INPUT_CONTRACTS), "unknown_capability", null]) {
    const v = validateFinalActorPayload(cap, [{ maxItems: 5 }]);
    assertEquals(v.ok, false, String(cap));
    assertEquals(v.violations, ["payload_not_object"], String(cap));
  }
});

Deno.test("shape and vocabulary violations are each refused by name", () => {
  const cases: Array<[unknown, string]> = [
    [{ maxItems: 5, bogusField: 1 }, "unsupported_field:bogusField"],
    [{ maxItems: "5" }, "expected_integer:maxItems"],
    [{ maxItems: 5, companySize: "1-10" }, "expected_array:companySize"],
    [{ maxItems: 5, scraperMode: ["full"] }, "unexpected_array:scraperMode"],
    [{ maxItems: 5, scraperMode: "turbo" }, "invalid_enum:scraperMode:turbo"],
    [{}, "empty_payload"],
  ];
  for (const [payload, expected] of cases) {
    const v = validateFinalActorPayload("apify_linkedin_company_search", payload);
    assertEquals(v.ok, false, JSON.stringify(payload));
    assert(v.violations.includes(expected),
      `${JSON.stringify(payload)} -> ${JSON.stringify(v.violations)}`);
  }
});

Deno.test("AN EMPTY ARRAY IS ONLY WRONG WHERE THE ARRAY IS THE ARGUMENT", () => {
  // `companies: []` asks the enrichment actor to enrich nothing.
  assert(validateFinalActorPayload("apify_linkedin_company_details", { companies: [] })
    .violations.includes("empty_array:companies"));
  assert(validateFinalActorPayload("apify_linkedin_job_search",
    { company: [], jobTitles: ["ae"], maxItems: 5 })
    .violations.includes("empty_array:company"));

  // But an empty FILTER is a legitimate call, and refusing it would break a
  // payload production sends correctly: `queries: []` is how memo23 says
  // "no name filter" in `mode: companies`.
  const memo = validateFinalActorPayload("apify_yc_companies_memo23", {
    mode: "companies", queries: [], isHiring: true, industries: ["B2B"], maxItems: 50,
  });
  assertEquals(memo.violations, []);
  assertEquals(
    validateFinalActorPayload("apify_linkedin_company_search",
      { maxItems: 5, locations: [] }).violations, [],
    "an empty location filter is not an empty argument");
});

Deno.test("the five bespoke job rules still apply, and now ALSO the contract", () => {
  // `linkedin_job_discovery` keeps its required/forbidden rules — those were
  // each written after a real incident and must not be softened.
  const v = validateFinalActorPayload("linkedin_job_discovery",
    { urls: ["x"], count: 5, jobsToFetch: 5, query: "q" });
  assertEquals(v.ok, false);
  assert(v.violations.some((x) => x.startsWith("foreign_serializer_key:urls")),
    JSON.stringify(v.violations));
});

// ══ 2. MERGE POLICY ═══════════════════════════════════════════════════════
//
// Mission: "Find 5 UK B2B SaaS companies with 20-200 employees actively hiring
// salespeople." Compiled by `icpDiscoveryConstraints` into industryIds/locations/
// companySize; the strategy model then proposes its own filters.

const MISSION = {
  industryIds: ["4", "96"],            // Software Development, IT Services
  locations: ["United Kingdom"],
  companySize: ["11-50", "51-200"],
};
const EXECUTION = { maxItems: 25, scraperMode: "full" };

Deno.test("MISSION GEOGRAPHY CANNOT SILENTLY DISAPPEAR", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { locations: ["United States"] },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.locations, ["United Kingdom"]);
  assert(m.strategy_overruled.includes("locations"));
});

Deno.test("MISSION INDUSTRY CANNOT BE SILENTLY REPLACED", () => {
  // Spread would have produced ["104"] — a staffing search for a SaaS mission.
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { industryIds: ["104"] },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.industryIds, ["4", "96"],
    "no shared value means the strategy proposed a different search, not a refinement");
  assert(m.strategy_overruled.includes("industryIds"));
});

Deno.test("…but the strategy MAY narrow it", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { industryIds: ["4"] },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.industryIds, ["4"]);
  assertEquals(m.provenance.find((p) => p.field === "industryIds")?.reason,
    "strategy narrowed the mission constraint");
});

Deno.test("MISSION COMPANY SIZE CANNOT BE BROADENED", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { companySize: ["11-50", "51-200", "201-500", "501-1000"] },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.companySize, ["11-50", "51-200"],
    "the intersection is the mission's own bands; the extra ones are dropped");
});

Deno.test("GPT CANNOT OVERRIDE maxItems", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { maxItems: 1000, scraperMode: "short" },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.maxItems, 25, "spend is execution's");
  assertEquals(m.input.scraperMode, "full", "and so is provider execution mode");
  assert(m.strategy_overruled.includes("maxItems"));
});

Deno.test("non-conflicting strategy additions SURVIVE", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: { searchQuery: "Acme", startPage: 2 },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input.searchQuery, "Acme", "a semantic field the strategy owns");
  assertEquals(m.input.industryIds, ["4", "96"]);
  assertEquals(m.input.locations, ["United Kingdom"]);
});

Deno.test("ALL FOUR COLLIDING AT ONCE", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION,
    strategyInput: {
      industryIds: ["96"], locations: ["Germany"],
      companySize: ["1-10"], maxItems: 500,
    },
    executionConstraints: EXECUTION,
  });
  assertEquals(m.input, {
    industryIds: ["96"],             // narrowed — shares a value
    locations: ["United Kingdom"],   // mission owns
    companySize: ["11-50", "51-200"], // no shared value: mission kept
    maxItems: 25,                    // execution
    scraperMode: "full",             // execution
  });
});

Deno.test("the merge is DETERMINISTIC and order-independent", () => {
  const a = mergeDiscoveryActorInput({
    missionConstraints: MISSION, strategyInput: { searchQuery: "x", industryIds: ["4"] },
    executionConstraints: EXECUTION });
  const b = mergeDiscoveryActorInput({
    missionConstraints: { companySize: MISSION.companySize, locations: MISSION.locations,
                          industryIds: MISSION.industryIds },
    strategyInput: { industryIds: ["4"], searchQuery: "x" },
    executionConstraints: { scraperMode: "full", maxItems: 25 } });
  assertEquals(canonicalJson(a.input), canonicalJson(b.input));
});

Deno.test("every contested field has a stated rule", () => {
  for (const f of ["industryIds", "locations", "companySize", "searchQuery",
                   "maxItems", "scraperMode"]) {
    assert(f in DISCOVERY_MERGE_POLICY, `${f} has no merge rule`);
  }
});

Deno.test("provenance records mission, strategy and final for every field", () => {
  const m = mergeDiscoveryActorInput({
    missionConstraints: MISSION, strategyInput: { maxItems: 900 },
    executionConstraints: EXECUTION });
  const p = m.provenance.find((x) => x.field === "maxItems")!;
  assertEquals(p.mission, undefined);
  assertEquals(p.strategy, 900);
  assertEquals(p.execution, 25);
  assertEquals(p.final, 25);
  assert(p.reason.length > 0);
});

// ══ 3. FINGERPRINTING ═════════════════════════════════════════════════════

Deno.test("SHA-256 matches the NIST vectors", () => {
  assertEquals(sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assertEquals(sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("KEY ORDER DOES NOT CHANGE THE FINGERPRINT", () => {
  assertEquals(
    providerInputFingerprint("a", { a: 1, b: 2 }),
    providerInputFingerprint("a", { b: 2, a: 1 }));
});

Deno.test("ARRAY order DOES change it", () => {
  // Deliberate: `jobTitles` order can change which rows a capped actor returns,
  // so two orderings are not the same purchase.
  assert(providerInputFingerprint("a", { t: ["x", "y"] }) !==
         providerInputFingerprint("a", { t: ["y", "x"] }));
});

Deno.test("THE ACTOR IS PART OF THE FINGERPRINT", () => {
  const input = { companies: ["https://www.linkedin.com/company/x"] };
  assert(providerInputFingerprint("apify_linkedin_company_details", input) !==
         providerInputFingerprint("apify_linkedin_company_employees", input));
});

Deno.test("one changed value changes it", () => {
  assert(providerInputFingerprint("a", { maxItems: 25 }) !==
         providerInputFingerprint("a", { maxItems: 26 }));
});

Deno.test("COMPILED HASH == OUTBOUND HASH", () => {
  // The guard `toolRegistry` enforces immediately before the POST.
  const c = compileHarvestCompanySearchInput({
    maxItems: 50, industryIds: ["104"], companySize: ["1-10"], scraperMode: "full",
  } as never);
  assert(c.ok);
  assertEquals(c.inputHash, hashInput(c.input, "apify_linkedin_company_search"));
  assert(isV2Fingerprint(c.inputHash), "new hashes announce their scheme");
});

// ── BACKWARD COMPATIBILITY: already-paid work must stay reusable ───────────

const rec = (ops: string[]): CompanyResumeRecord => ({
  company_key: "https://www.linkedin.com/company/storm4", company_name: "Storm4",
  identity: "resolved", enrichment: "completed", hiring: "verified_externally",
  brain: "not_started", founder: "not_started", linkedin_company_url: null,
  completed_operations: ops, updated_at: "2026-08-30T00:00:00.000Z",
});

Deno.test("A HISTORICAL djb2 OPERATION IS STILL RECOGNISED", () => {
  // The checkpoint was written before v2 existed. If only the new key were
  // checked, every already-paid search in every existing lineage would look
  // unbought and be purchased again.
  const input = { company: ["https://www.linkedin.com/company/storm4"], maxItems: 20 };
  const scope = {
    workspace_id: "ws", lineage_root_task_id: "lin",
    company_key: "https://www.linkedin.com/company/storm4",
    capability: "hiring_verification", provider: "apify_linkedin_job_search",
  };
  const legacyKey = providerOperationKey({ ...scope, input_fingerprint: inputFingerprint(input) });
  const v2Key = providerOperationKey({ ...scope, input_fingerprint: inputFingerprintV2(scope.provider, input) });
  assert(legacyKey !== v2Key, "the schemes genuinely differ");

  const historical = rec([legacyKey]);
  assertEquals(shouldSkipProviderCall(historical, v2Key, [legacyKey]),
    { skip: true, reason: "already_completed" },
    "a search this lineage already paid for must not be bought again");
  // And without the legacy key it would have been re-bought — the thing the
  // compatibility argument turns on.
  assertEquals(shouldSkipProviderCall(historical, v2Key).skip, false);
});

Deno.test("a v2 operation is recognised on its own", () => {
  const key = providerOperationKey({
    workspace_id: "ws", lineage_root_task_id: "lin", company_key: "c",
    capability: "hiring_verification", provider: "apify_linkedin_job_search",
    input_fingerprint: inputFingerprintV2("apify_linkedin_job_search", { a: 1 }),
  });
  assertEquals(shouldSkipProviderCall(rec([key]), key).skip, true);
});

Deno.test("an UNRELATED historical key does not grant a skip", () => {
  // Compatibility must not become "any old key will do".
  const other = providerOperationKey({
    workspace_id: "ws", lineage_root_task_id: "lin", company_key: "c",
    capability: "hiring_verification", provider: "apify_linkedin_job_search",
    input_fingerprint: legacyDjb2Fingerprint({ different: true }),
  });
  const wanted = providerOperationKey({
    workspace_id: "ws", lineage_root_task_id: "lin", company_key: "c",
    capability: "hiring_verification", provider: "apify_linkedin_job_search",
    input_fingerprint: inputFingerprintV2("apify_linkedin_job_search", { a: 1 }),
  });
  assertEquals(shouldSkipProviderCall(rec([other]), wanted, [other + "x"]).skip, false);
});

// ── the wiring ────────────────────────────────────────────────────────────

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("discovery no longer assembles its input by spread", () => {
  assert(code.includes("mergeDiscoveryActorInput({"), "the merge contract must be used");
  assert(!/compileHarvestCompanySearchInput\(\{\s*maxItems: maxCandidates,/.test(code),
    "the old spread must be gone");
});

Deno.test("the skip check is given the legacy key", () => {
  assert(/shouldSkipProviderCall\(\s*priorRecords\.get\(company\.key\), operationKey, legacyOperationKeys\)/
    .test(code), "already-paid work must stay recognisable");
  assert(code.includes("inputFingerprintV2(provider, call.input)"),
    "new keys use v2, with the actor included");
});
