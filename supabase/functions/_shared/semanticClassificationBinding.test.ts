// Runtime tests for the semantic-classification production edge.
//
// These assert the parts that cost money or change verdicts: the flag pair, the
// allowance, escalation, and the guarantee that a failing classifier never
// qualifies or rejects a company on its own.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";
import {
  buildSemanticClassificationBinding,
  classificationTaskDiagnostics,
  CLASSIFIER_SYSTEM_PROMPT,
  DEFAULT_CLASSIFICATION_MODEL,
  DEFAULT_MAX_CLASSIFICATION_CALLS,
  isSemanticClassificationEnabled,
} from "./semanticClassificationBinding.ts";

const WS = "e510c1a6-2bb8-4aa4-95f7-0beb786ed995";

/** A fake env. Never reads the real process environment. */
const env = (o: Record<string, string>) => (k: string) => o[k];

const ON = {
  SEMANTIC_COMPANY_CLASSIFICATION: "true",
  SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: WS,
};

// ── 1. OFF BY DEFAULT ────────────────────────────────────────────────────────
Deno.test("1. no env at all => disabled, no model, zero allowance", () => {
  const r = isSemanticClassificationEnabled(WS, env({}));
  assertEquals(r.enabled, false);
  assertEquals(r.reason, "flag_off");
  assertEquals(r.model, null);
  assertEquals(r.maxCalls, 0);
});

// ── 2. THE FLAG ALONE IS NOT ENOUGH ──────────────────────────────────────────
Deno.test("2. flag on but no allow-list => disabled (no global switch exists)", () => {
  const r = isSemanticClassificationEnabled(WS, env({ SEMANTIC_COMPANY_CLASSIFICATION: "true" }));
  assertEquals(r.enabled, false);
  assertEquals(r.reason, "no_workspace_allowlist");

  // A wildcard is NOT a wildcard — it is just an id that matches nobody.
  const star = isSemanticClassificationEnabled(WS, env({
    SEMANTIC_COMPANY_CLASSIFICATION: "true",
    SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: "*",
  }));
  assertEquals(star.enabled, false);
  assertEquals(star.reason, "workspace_not_allowed");
});

// ── 3. THE ALLOW-LIST ALONE IS NOT ENOUGH ────────────────────────────────────
Deno.test("3. allow-listed but flag off => disabled", () => {
  const r = isSemanticClassificationEnabled(WS, env({
    SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: WS,
  }));
  assertEquals(r.enabled, false);
  assertEquals(r.reason, "flag_off");
});

// ── 4. A NON-ALLOW-LISTED WORKSPACE IS UNAFFECTED ────────────────────────────
Deno.test("4. another workspace stays off while the pilot workspace is on", () => {
  assertEquals(isSemanticClassificationEnabled(WS, env(ON)).enabled, true);
  const other = isSemanticClassificationEnabled("11111111-2222-3333-4444-555555555555", env(ON));
  assertEquals(other.enabled, false);
  assertEquals(other.reason, "workspace_not_allowed");
});

// ── 5. THE DECIDED MODEL AND ALLOWANCE ───────────────────────────────────────
Deno.test("5. enabled => gpt-5.6-luna and ten calls", () => {
  const r = isSemanticClassificationEnabled(WS, env(ON));
  assertEquals(r.enabled, true);
  assertEquals(r.model, "gpt-5.6-luna");
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

// ── 7. DISABLED MEANS NO CALLABLE CLASSIFIER AT ALL ──────────────────────────
Deno.test("7. disabled binding exposes no classifier, so no call can happen", () => {
  const b = buildSemanticClassificationBinding({ workspaceId: WS, read: env({}) });
  assertEquals(b.classifyCompanyEvidence, null);
  assertEquals(b.classificationCallsRemaining, 0);
  assertEquals(b.diagnostics.calls_allowed, 0);
  assertEquals(b.diagnostics.skip_reason, "flag_off");
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
  assertEquals(b.diagnostics.model, "gpt-5.6-luna");
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
  assertEquals(spent.model, "gpt-5.6-luna");

  // Zero paid calls is a real outcome, not a missing measurement.
  const free = classificationTaskDiagnostics(b, {
    calls_allowed: 10, calls_made: 0, calls_remaining: 10,
    budget_exhausted: false, companies_classified: 0,
    skipped: { identity_unresolved: 6 },
  });
  assertEquals(free.calls_made, 0);
  assertEquals(free.budget_exhausted, false);

  // A disabled run still records WHY nothing ran.
  const off = classificationTaskDiagnostics(
    buildSemanticClassificationBinding({ workspaceId: WS, read: env({}) }), null,
  );
  assertEquals(off.enabled, false);
  assertEquals(off.calls_made, 0);
  assertEquals(off.budget_exhausted, false);
});

// ── 13. THE PINNED MODEL REALLY REACHES THE MODEL LAYER ──────────────────────
// The diagnostics claim gpt-5.6-luna. Without this the facade would quietly use
// its own primary planning tier and the audit record would be a fiction.
Deno.test("13. the facade calls gpt-5.6-luna, and never escalates", async () => {
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

  assertEquals(seen, ["gpt-5.6-luna"], "the pinned classifier model must be the one called");
  assertEquals(out, null, "unparseable output is not evidence");
});
