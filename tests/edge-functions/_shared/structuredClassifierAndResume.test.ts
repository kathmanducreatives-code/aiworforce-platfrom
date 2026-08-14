// ONE CLASSIFIER CONTRACT, AND A RESUME THAT DOES NOT RE-BUY.
//
// Stage 2 wired the semantic module internally but `deps.classifyCompany` still
// returned `{verdict, reason}`, so the LIVE path could never produce a
// business-model judgement — only an offline stub could. And continuation
// 90bad481 died at 109,009 ms with seven companies at `verifying`, their
// identity and enrichment already paid for and recorded nowhere per company.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FALLBACK_REVIEW, applyMissionPrecedence, buildClassifierPayload,
  decideCompanyBrain, parseSemanticFitStrict, SEMANTIC_INPUT_SCHEMA_VERSION,
  type HardGateInput,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import {
  CHECKPOINT_RESERVE_MS, buildCheckpoint, companyIsComplete, continuationAvailable,
  inputFingerprint, newCompanyRecord, nextStageFor, providerOperationKey,
  runIsComplete, shouldCheckpoint, shouldSkipProviderCall,
  type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const POLICY = applyMissionPrecedence({
  original_user_query: "Find founders of SaaS startups hiring Sales Operations in the United States.",
  mission_verticals: ["saas"], mission_geography: "United States",
  workspace_industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
});
const gates = (o: Partial<HardGateInput> = {}): HardGateInput => ({
  identity_status: "verified_match", active: true, geography: "United States",
  required_geography: "United States", employee_count: 40, employee_ceiling: 200,
  commercial_tier: "A", semantic: null, ...o,
});

// ═══════════════ 1-10. the classifier contract ══

Deno.test("1. the capability engine binds NO second semantic evaluator", async () => {
  // THIS TEST WAS INVERTED, and the inversion is the point.
  //
  // It used to assert that `classifyCompany` was wired from run-agent into the
  // capability engine, carrying the full structured schema. That wiring was the
  // architecture's SECOND semantic authority, and — because `MISSION_EVALUATION`
  // is off by default and this path is exactly the one taken when it is — the
  // one that decided in production.
  //
  // The Mission evaluator is the semantic authority. The engine no longer
  // accepts a classifier at all, so the second evaluator cannot come back by
  // someone re-adding a dependency.
  const engine = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assertFalse(/classifyCompany\?:/.test(engine),
    "the engine must not declare a classifier dependency");
  assertFalse(/deps\.classifyCompany/.test(engine),
    "and it must not call one");
  assert(/evaluateMission\?:/.test(engine),
    "the Mission evaluator remains the one semantic seam");

  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assertFalse(/classifyCompany:/.test(src),
    "run-agent must not pass a classifier into the engine");
  assert(src.includes("evaluateMission:"),
    "it passes the evaluator instead");

  // The classifier MODULE still exists and is still tested below — it serves
  // the legacy company-first route, which is a separate execution path. What
  // was deleted is its role as a qualification authority in the Mission
  // pipeline, not the code itself.
  assertFalse(/return v === "pass" \|\| v === "fail" \|\| v === "unknown"/.test(src),
    "the old {verdict, reason} squeeze must stay gone");
});

Deno.test("2. valid B2B evidence produces a semantic pass", () => {
  const p = parseSemanticFitStrict({
    business_model: "b2b_saas", company_fit: "pass", confidence: 0.82,
    agentory_use_case: "strong",
    supporting_evidence: ["API sold to engineering teams"],
    conflicting_evidence: [], unknown_fields: [], reason: "software sold to businesses",
  });
  assertEquals(p.parse_status, "valid");
  assertEquals(p.assessment.company_fit, "pass");
  assertEquals(decideCompanyBrain({
    gates: gates(), semantic: p.assessment, policy: POLICY, hiring_verified: true,
  }).outcome, "QUALIFIED");
});

Deno.test("3/5/6. an unexplained pass is downgraded, never honoured", () => {
  // Pass with NO supporting evidence — the "Software Development alone" case.
  const noEvidence = parseSemanticFitStrict({
    business_model: "b2b_saas", company_fit: "pass", confidence: 0.9,
    agentory_use_case: "strong", supporting_evidence: [], reason: "looks like software",
  });
  assertEquals(noEvidence.assessment.company_fit, "review");
  assertEquals(noEvidence.parse_status, "repaired");
  assert(noEvidence.raw_shape.repaired_fields.includes("company_fit:pass_without_supporting_evidence"));

  // Pass with no credible use case.
  const noUseCase = parseSemanticFitStrict({
    business_model: "b2b_saas", company_fit: "pass", confidence: 0.9,
    agentory_use_case: "none", supporting_evidence: ["sells software"], reason: "x",
  });
  assertEquals(noUseCase.assessment.company_fit, "review");
  assert(noUseCase.raw_shape.repaired_fields.includes("company_fit:pass_without_use_case"));
});

Deno.test("4/7. malformed output becomes REVIEW and confidence is clamped", () => {
  for (const bad of [null, "not json", 42, [], { nonsense: true }]) {
    const p = parseSemanticFitStrict(bad);
    assertEquals(p.assessment.company_fit, "review", `${JSON.stringify(bad)} must be REVIEW`);
    assertEquals(p.assessment.business_model, "unknown");
    assertEquals(p.assessment.confidence, 0);
    assertEquals(p.parse_status, "invalid_fallback_review");
    // NEVER a pass, whatever arrives.
    assertFalse(p.assessment.company_fit === "pass");
  }
  assertEquals(parseSemanticFitStrict({ company_fit: "review", confidence: 9 }).assessment.confidence, 1);
  assertEquals(parseSemanticFitStrict({ company_fit: "review", confidence: -3 }).assessment.confidence, 0);
  assertEquals(parseSemanticFitStrict({ company_fit: "review", confidence: "x" }).assessment.confidence, 0);
  // An unrecognised enum rejects the FIELD, not the company.
  const junk = parseSemanticFitStrict({ business_model: "wat", company_fit: "definitely", reason: "r" });
  assertEquals(junk.assessment.business_model, "unknown");
  assertEquals(junk.assessment.company_fit, "review");
  assert(junk.raw_shape.rejected_values.some((v) => v.includes("business_model")));
});

Deno.test("8/9/10. review, missing evidence and hard gates", () => {
  // Unknown non-critical evidence → REVIEW.
  assertEquals(decideCompanyBrain({
    gates: gates(),
    semantic: { ...FALLBACK_REVIEW, business_model: "b2b_saas", unknown_fields: ["hq"] },
    policy: POLICY, hiring_verified: true }).outcome, "REVIEW");

  // A DETERMINISTIC hard failure overrides a semantic pass.
  const overridden = decideCompanyBrain({
    gates: gates({ employee_count: 900 }),
    semantic: { business_model: "b2b_saas", company_fit: "pass", confidence: 0.95,
      agentory_use_case: "strong", supporting_evidence: ["e"], conflicting_evidence: [],
      unknown_fields: [], reason: "great fit" },
    policy: POLICY, hiring_verified: true });
  assertEquals(overridden.outcome, "REJECT");
  assert(overridden.failed_hard_gates.includes("employee_count_far_above_ceiling"));

  // Weak/missing evidence must not become a hard REJECT.
  assertEquals(decideCompanyBrain({
    gates: gates({ geography: null, employee_count: null }),
    semantic: { ...FALLBACK_REVIEW }, policy: POLICY, hiring_verified: true,
  }).outcome, "REVIEW");
});

Deno.test("11/12. the payload is versioned and the prompt states the rules", () => {
  const payload = buildClassifierPayload({
    original_user_query: "Find founders of SaaS startups hiring Sales Operations in the United States.",
    mission_verticals: ["saas"], mission_geography: "United States",
    workspace_industries: [], company_name: "SnapMagic",
    yc_description: "AI-assisted electronics design", website_description: null,
    linkedin_description: null, linkedin_industry: "Software Development",
    linkedin_industry_ids: ["Software Development"], employee_count: 23,
    employee_advisory: null, geography: "United States",
    commercial_signal: "Head of Sales", commercial_tier: "A",
  }, POLICY);
  assertEquals(payload.schema_version, SEMANTIC_INPUT_SCHEMA_VERSION);
  const instruction = String(payload.instruction);
  assert(instruction.includes("WEAK METADATA"));
  assert(instruction.includes("do not accept"), "the label must not auto-pass");
  assert(instruction.includes("IGNORE these unrelated workspace categories: Recruiting Agencies"));
  assert(instruction.includes("Return ONLY this JSON"), "no prose outside the object");
  assert(JSON.stringify(payload).includes("Head of Sales"));
});

// ═══════════════ 15-21. deadline reserve and resume ══

Deno.test("15/16. the reserve checkpoints BEFORE termination", () => {
  const clock = (remaining: number) => ({ elapsedMs: () => 0, remainingMs: () => remaining });
  assertFalse(shouldCheckpoint(clock(60_000)));
  assert(shouldCheckpoint(clock(CHECKPOINT_RESERVE_MS)));
  assert(shouldCheckpoint(clock(5_000)));
  // The reserve must exceed the slowest downstream provider (~11s company
  // details), or the engine authorises a call it cannot finish.
  assert(CHECKPOINT_RESERVE_MS > 11_000, "a reserve below the slowest call is no reserve");

  const cp = buildCheckpoint({
    now: 0, deadlineAt: 125_000, remainingMs: 12_000,
    lastCompletedCapability: "company_enrichment",
    nextPendingCapability: "company_brain_qualification",
    companies: [{ ...newCompanyRecord("a.com", "A"), identity: "resolved",
      enrichment: "completed", hiring: "verified_from_existing_evidence" }],
    reason: "execution_deadline_checkpoint",
  });
  assertEquals(cp.checkpoint_reason, "execution_deadline_checkpoint");
  assert(cp.continuation_required);
  assertFalse(runIsComplete(cp), "Run complete must not be shown with pending work");
  assert(continuationAvailable(cp));
  assertEquals(cp.time_remaining_at_checkpoint_ms, 12_000);
});

Deno.test("17/18. pending keys are persisted and resume starts at the right stage", () => {
  const done: CompanyResumeRecord = { ...newCompanyRecord("snapmagic.com", "SnapMagic"),
    identity: "resolved", enrichment: "completed",
    hiring: "verified_from_existing_evidence", brain: "not_started" };
  assertEquals(nextStageFor(done), "brain",
    "identity, enrichment and hiring are paid for — resume at the Brain");

  const finished: CompanyResumeRecord = { ...done, brain: "qualified", founder: "completed" };
  assertEquals(nextStageFor(finished), null);
  assert(companyIsComplete(finished));

  // A terminal identity is FINISHED, not retried forever.
  assertEquals(nextStageFor({ ...newCompanyRecord("x", "X"), identity: "unresolved" }), null);
  assertEquals(nextStageFor({ ...newCompanyRecord("x", "X"), identity: "mismatch" }), null);
  // Only an explicit Brain pass reaches people discovery.
  assertEquals(nextStageFor({ ...done, brain: "review" }), null);
  assertEquals(nextStageFor({ ...done, brain: "qualified" }), "founder");

  const cp = buildCheckpoint({
    now: 0, deadlineAt: 1, remainingMs: 0,
    lastCompletedCapability: "company_enrichment", nextPendingCapability: null,
    companies: [done, finished], reason: "execution_deadline_checkpoint",
  });
  assertEquals(cp.pending_company_keys, ["snapmagic.com"]);
  assertEquals(cp.completed_company_keys.length, 1);
});

Deno.test("19/20. completed provider work is recognised and skipped", () => {
  const key = providerOperationKey({
    workspace_id: "ws", lineage_root_task_id: "root", company_key: "snapmagic.com",
    capability: "company_identity_resolution", provider: "apify_linkedin_company_search",
    input_fingerprint: inputFingerprint({ searchQuery: "SnapMagic", maxItems: 5 }),
  });
  // STABLE ACROSS INVOCATIONS: no task id, no timestamp — a continuation asking
  // the same question must produce the same key, or it re-buys everything.
  const again = providerOperationKey({
    workspace_id: "ws", lineage_root_task_id: "root", company_key: "snapmagic.com",
    capability: "company_identity_resolution", provider: "apify_linkedin_company_search",
    input_fingerprint: inputFingerprint({ maxItems: 5, searchQuery: "SnapMagic" }),
  });
  assertEquals(key, again, "key order must not change the fingerprint");

  const rec: CompanyResumeRecord = { ...newCompanyRecord("snapmagic.com", "SnapMagic"),
    identity: "resolved", completed_operations: [key] };
  assertEquals(shouldSkipProviderCall(rec, key), { skip: true, reason: "already_completed" });
  assertEquals(shouldSkipProviderCall(rec, "other-key").skip, false,
    "a different question is still asked");
  // A terminal identity stops further paid work for that company.
  assertEquals(shouldSkipProviderCall(
    { ...rec, identity: "unresolved", completed_operations: [] }, "k").reason, "identity_terminal");
  // No record at all means nothing is known to be done.
  assertEquals(shouldSkipProviderCall(undefined, key).skip, false);
});

Deno.test("21/22/23/24. counters and button visibility follow the checkpoint", () => {
  const finishedRun = buildCheckpoint({
    now: 0, deadlineAt: 1, remainingMs: 90_000,
    lastCompletedCapability: "persistence", nextPendingCapability: null,
    companies: [{ ...newCompanyRecord("a", "A"), identity: "resolved", enrichment: "completed",
      hiring: "verified_from_existing_evidence", brain: "qualified", founder: "completed" }],
    reason: "all_work_complete",
  });
  assert(runIsComplete(finishedRun));
  assertFalse(continuationAvailable(finishedRun), "a finished run hides the button");
  assertEquals(finishedRun.pending_company_keys.length, 0);

  // A pending CAPABILITY counts as unfinished even with no pending company.
  const capabilityPending = buildCheckpoint({
    now: 0, deadlineAt: 1, remainingMs: 5_000,
    lastCompletedCapability: "company_enrichment",
    nextPendingCapability: "company_brain_qualification",
    companies: [], reason: "execution_deadline_checkpoint",
  });
  assert(capabilityPending.continuation_required);
  assertFalse(runIsComplete(capabilityPending));
  assert(continuationAvailable(capabilityPending));
});

// ═══════════════ 25-28. safety ══

Deno.test("25/26/27/28. the modules are pure and contact no project", async () => {
  for (const f of ["leadResumeState.ts", "companyBrainSemanticFit.ts"]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    for (const forbidden of ["fetch(", "apifyFetch", "createClient", "Deno.env",
      "wqnigjhcwjxtmordrwno", "SERVICE_ROLE"]) {
      assertFalse(src.includes(forbidden), `${forbidden} must not appear in ${f}`);
    }
  }
});
