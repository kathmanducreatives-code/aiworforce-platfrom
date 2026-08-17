// Runtime tests for the semantic-classification production edge.
//
// These assert the parts that cost money or change verdicts: the flag pair, the
// allowance, escalation, and the guarantee that a failing classifier never
// qualifies or rejects a company on its own.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createStrategistGenerateJson } from "../../../supabase/functions/_shared/leadStrategyFeedbackOwner.ts";
import {
  buildSemanticClassificationBinding,
  classificationTaskDiagnostics,
  CLASSIFIER_SYSTEM_PROMPT,
  DEFAULT_CLASSIFICATION_MODEL,
  DEFAULT_MAX_CLASSIFICATION_CALLS,
  isSemanticClassificationEnabled,
} from "../../../supabase/functions/_shared/semanticClassificationBinding.ts";

const WS = "e510c1a6-2bb8-4aa4-95f7-0beb786ed995";

/** A fake env. Never reads the real process environment. */
const env = (o: Record<string, string>) => (k: string) => o[k];

const ON = {
  SEMANTIC_COMPANY_CLASSIFICATION: "true",
  SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: WS,
};

// ── 1. OFF BY DEFAULT ────────────────────────────────────────────────────────
// ── REPLACED: TESTS 1-3 DESCRIBED THE FLAG, AND THE FLAG IS GONE ─────────
//
// "off by default", "the flag alone is not enough", "the allow-list alone is
// not enough" — three tests of a gate that returned `flag_off` on every live
// run, so semantic classification never executed once. The decision is removed,
// not defaulted; the inverse is what matters now.
Deno.test("1-3. no environment can disable classification", () => {
  for (const e of [
    env({}),
    env({ SEMANTIC_COMPANY_CLASSIFICATION: "false" }),
    env({ SEMANTIC_COMPANY_CLASSIFICATION: "true" }),
    env({ SEMANTIC_COMPANY_CLASSIFICATION: "true", SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: "*" }),
    env({ SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: WS }),
  ]) {
    const r = isSemanticClassificationEnabled(WS, e);
    assertEquals(r.enabled, true, "classification must stay on");
    assertEquals(r.reason, "enabled");
    assert(r.maxCalls > 0, "and carry a real allowance");
  }
});

// ── 2. THE FLAG ALONE IS NOT ENOUGH ──────────────────────────────────────────
// ── 3. THE ALLOW-LIST ALONE IS NOT ENOUGH ────────────────────────────────────
// ── 4. A NON-ALLOW-LISTED WORKSPACE IS UNAFFECTED ────────────────────────────
// ── REPLACED: PER-WORKSPACE GATING IS GONE ───────────────────────────────
//
// This asserted a pilot workspace could be on while another stayed off. That
// per-workspace switch is what kept the stage dark everywhere, and it is
// removed: understanding a user's request is not a per-tenant opt-in.
Deno.test("4. every workspace gets the same intelligence", () => {
  for (const ws of [WS, "22222222-3333-4444-5555-666666666666"]) {
    assertEquals(isSemanticClassificationEnabled(ws, env(ON)).enabled, true);
    assertEquals(isSemanticClassificationEnabled(ws, env({})).enabled, true);
  }
});

// ── 5. THE DECIDED MODEL AND ALLOWANCE ───────────────────────────────────────
Deno.test("5. enabled => the canonical pinned model and ten calls", () => {
  const r = isSemanticClassificationEnabled(WS, env(ON));
  assertEquals(r.enabled, true);
  assertEquals(r.model, DEFAULT_CLASSIFICATION_MODEL);
  assertEquals(r.model, DEFAULT_CLASSIFICATION_MODEL);
  assertEquals(r.maxCalls, 10);
  assertEquals(r.maxCalls, DEFAULT_MAX_CLASSIFICATION_CALLS);
});

// ── 6. THE ALLOWANCE CANNOT BE RAISED BY ENV ─────────────────────────────────
Deno.test("6. env may lower the allowance but never exceed ten", () => {
  const raised = isSemanticClassificationEnabled(WS, env({
    ...ON, SEMANTIC_COMPANY_CLASSIFICATION_MAX_CALLS: "500",
  }));
  assertEquals(raised.maxCalls, 10, "a misconfigured env must not authorise 500 paid calls");

  assertEquals(isSemanticClassificationEnabled(WS, env({
    ...ON, SEMANTIC_COMPANY_CLASSIFICATION_MAX_CALLS: "3",
  })).maxCalls, 3);

  // Garbage falls back to the decided default rather than to zero or NaN.
  assertEquals(isSemanticClassificationEnabled(WS, env({
    ...ON, SEMANTIC_COMPANY_CLASSIFICATION_MAX_CALLS: "abc",
  })).maxCalls, 10);
});

// ── 7. THE ONLY REASON TO EXPOSE NO CLASSIFIER IS COVERAGE ───────────────────
//
// This asserted that an unconfigured environment yields a null classifier and
// `skip_reason: "flag_off"`. That was every live run. The binding now always
// offers a classifier, and the ONE remaining reason to withhold it is the
// legitimate one: the requested quota is already served, so more interpretation
// cannot produce a lead the mission still needs.
Deno.test("7. an unconfigured environment still exposes a classifier", () => {
  const b = buildSemanticClassificationBinding({ workspaceId: WS, read: env({}) });
  assert(b.classifyCompanyEvidence !== null, "no env may remove the classifier");
  assert(b.classificationCallsRemaining > 0);

  // Coverage, on the other hand, still stops it — and says so.
  const served = buildSemanticClassificationBinding({
    workspaceId: WS, read: env({}), requestedLeadCount: 5, qualifiedCompanies: 5,
  });
  assertEquals(served.classifyCompanyEvidence, null);
  assertEquals(served.diagnostics.skip_reason, "sufficient_qualified_coverage");
});

// ── 8. SUFFICIENT COVERAGE STOPS CLASSIFICATION ──────────────────────────────
Deno.test("8. quota already covered => classification does not run", () => {
  const covered = buildSemanticClassificationBinding({
    workspaceId: WS, read: env(ON), requestedLeadCount: 5, qualifiedCompanies: 5,
  });
  assertEquals(covered.classifyCompanyEvidence, null);
  assertEquals(covered.classificationCallsRemaining, 0);
  assertEquals(covered.diagnostics.skip_reason, "sufficient_qualified_coverage");

  // One short of the quota still classifies — coverage must be MET, not close.
  const short = buildSemanticClassificationBinding({
    workspaceId: WS, read: env(ON), requestedLeadCount: 5, qualifiedCompanies: 4,
  });
  assert(short.classifyCompanyEvidence !== null);
  assertEquals(short.classificationCallsRemaining, 10);
});

// ── 9. THE ALLOWANCE REACHES THE PIPELINE ────────────────────────────────────
Deno.test("9. enabled binding hands the pipeline exactly ten calls", () => {
  const b = buildSemanticClassificationBinding({
    workspaceId: WS, read: env(ON), requestedLeadCount: 5, qualifiedCompanies: 0,
    generate: () => Promise.resolve({ ok: true, json: {} }) as never,
  });
  assertEquals(b.classificationCallsRemaining, 10);
  assertEquals(b.diagnostics.model, DEFAULT_CLASSIFICATION_MODEL);
  assertEquals(b.diagnostics.enabled, true);
});

// ── 10. A FAILING CLASSIFIER RETURNS NOTHING, NOT A VERDICT ──────────────────
Deno.test("10. failure, invalid output and refusal all yield null, never a verdict", async () => {
  for (const result of [
    { ok: false, error: "timeout" },
    { ok: false, json: { industry: "saas" } },   // failed, but carrying a payload
    null,
    undefined,
  ]) {
    const b = buildSemanticClassificationBinding({
      workspaceId: WS, read: env(ON), requestedLeadCount: 5,
      generate: () => Promise.resolve(result) as never,
    });
    const out = await b.classifyCompanyEvidence!({ company: "Acme" });
    assertEquals(out, null, "a failed classification must not reach the Brain as evidence");
  }
});

// ── 11. NO ESCALATION, AND NO SECRETS IN THE PROMPT ──────────────────────────
Deno.test("11. the classifier never escalates and never carries credentials", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const b = buildSemanticClassificationBinding({
    workspaceId: WS, read: env(ON), requestedLeadCount: 5,
    generate: ((req: Record<string, unknown>) => {
      calls.push(req);
      return Promise.resolve({ ok: true, json: { industry: "saas" } });
    }) as never,
  });

  await b.classifyCompanyEvidence!({ company: "Acme", source_refs: ["job:1"] });

  assertEquals(calls.length, 1, "exactly one model request per company — no retry tier");
  const sent = JSON.stringify(calls[0]);
  for (const forbidden of ["api_key", "apiKey", "authorization", "Bearer ", "sk-", "SUPABASE_", "APIFY_"]) {
    assert(!sent.includes(forbidden), `classification payload must not carry ${forbidden}`);
  }

  // The prompt interprets; it does not decide.
  assert(CLASSIFIER_SYSTEM_PROMPT.includes("do NOT qualify") ||
    CLASSIFIER_SYSTEM_PROMPT.includes("You do NOT qualify"));
  assert(CLASSIFIER_SYSTEM_PROMPT.includes("evidence_ref"));
});

// ── 12. THE TASK AUDIT REFLECTS WHAT ACTUALLY HAPPENED ───────────────────────
Deno.test("12. task diagnostics report allowance, spend, skips and exhaustion", () => {
  const b = buildSemanticClassificationBinding({ workspaceId: WS, read: env(ON), requestedLeadCount: 5 });

  const spent = classificationTaskDiagnostics(b, {
    calls_allowed: 10, calls_made: 10, calls_remaining: 0,
    budget_exhausted: true, companies_classified: 8,
    skipped: { already_classified: 4, explicit_evidence_sufficient: 2 },
  });
  assertEquals(spent.calls_allowed, 10);
  assertEquals(spent.calls_made, 10);
  assertEquals(spent.budget_exhausted, true);
  assertEquals(spent.companies_classified, 8);
  assertEquals((spent.skipped as Record<string, number>).already_classified, 4);
  assertEquals(spent.model, DEFAULT_CLASSIFICATION_MODEL);

  // Zero paid calls is a real outcome, not a missing measurement.
  const free = classificationTaskDiagnostics(b, {
    calls_allowed: 10, calls_made: 0, calls_remaining: 10,
    budget_exhausted: false, companies_classified: 0,
    skipped: { identity_unresolved: 6 },
  });
  assertEquals(free.calls_made, 0);
  assertEquals(free.budget_exhausted, false);

  // A run that made no calls still records that fact. It can no longer be
  // DISABLED, so what used to read `enabled: false` now reads `enabled: true`
  // with zero spend — which is the honest description of a stage that was
  // available and simply had nothing to do.
  const idle = classificationTaskDiagnostics(
    buildSemanticClassificationBinding({ workspaceId: WS, read: env({}) }), null,
  );
  assertEquals(idle.enabled, true, "the stage is always available now");
  assertEquals(idle.calls_made, 0);
  assertEquals(idle.budget_exhausted, false);
});

// ── 13. THE PINNED MODEL REALLY REACHES THE MODEL LAYER ──────────────────────
// The diagnostics name a model. Without this the facade would quietly use its
// own primary planning tier and the audit record would be a fiction.
// Asserted against the constant, never a literal: a literal here is exactly
// how the unprefixed id survived review. `leadIntelligenceModelSeam.test.ts`
// is what proves the constant is an id the adapter will actually accept.
Deno.test("13. the facade calls the pinned model, and never escalates", async () => {
  const seen: string[] = [];
  const generate = createStrategistGenerateJson({
    allowEscalation: false,
    model: DEFAULT_CLASSIFICATION_MODEL,
    callModel: (c: { model: string }) => {
      seen.push(c.model);
      // Invalid output is the ONE condition that would normally escalate.
      return Promise.resolve({ ok: false, errorCode: "json_parse_failed", error: "bad json" });
    },
  } as never);

  const b = buildSemanticClassificationBinding({
    workspaceId: WS, read: env(ON), requestedLeadCount: 5, generate,
  });
  const out = await b.classifyCompanyEvidence!({ company: "Acme" });

  assertEquals(seen, [DEFAULT_CLASSIFICATION_MODEL],
    "the pinned classifier model must be the one called");
  assertEquals(out, null, "unparseable output is not evidence");
});
