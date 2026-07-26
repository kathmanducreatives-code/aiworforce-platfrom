// THE RUN-AGENT BRIDGE — enablement and behavior preservation.
// ZERO live model calls, ZERO provider calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyClaudeFirstLeadPlanning, isClaudeFirstLeadPlanningEnabled, bridgeDiagnostics,
  CLAUDE_FIRST_WORKSPACES_ENV, type JobSearchSpecSlice,
} from "./leadPlanningBridge.ts";
import type { GenerateJsonFn } from "../plannerWrapper.ts";
import type { GenerateResult } from "../../aiProvider.ts";

const PRIMARY = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const WS = "zbwsbnqqpkvdhqwavjke-workspace";

function spec(): JobSearchSpecSlice {
  return {
    keyword_queries: ["Sales Operations", "Revenue Operations"],
    requested_person_roles: ["Founder", "Co-Founder", "CEO"],
    location: "United States",
    country: "US",
    company_vertical: "b2b_saas",
    original_query: PRIMARY,
  };
}

function env(vars: Record<string, string>) {
  return (k: string) => vars[k];
}

const GOOD_STRATEGY = {
  interpretation: { summary: "s", assumptions: [], ambiguities: [], confidence: 0.9 },
  strategy: {
    role_ontology: {
      canonical_concept: "sales operations", seniority: [],
      exact_titles: ["Sales Operations", "Revenue Operations"],
      safe_synonyms: [{ title: "GTM Operations", language: "en", relationship: "safe_synonym", confidence: 0.9 }],
      adjacent_titles: [], excluded_titles: [],
    },
    company_interpretation: { verticals: ["b2b_saas"], company_types: [], positive_keywords: [], negative_keywords: [] },
    searches: [
      { purpose: "discover_hiring_companies", capability_key: "jobs_search", titles: ["Sales Operations", "Revenue Operations", "GTM Operations"], locations: ["United States"], result_target: 25, rationale: "r" },
      { purpose: "find_decision_makers", capability_key: "contact_enrichment", titles: ["Founder", "CEO"], locations: ["United States"], result_target: 10, rationale: "r" },
    ],
    exclusions: { titles: [], companies: [], industries: [] },
    expected_funnel: { raw_results: 25, relevant_jobs: 15, qualified_companies: 9, verified_people: 7, contact_ready_leads: 5 },
    confidence: 0.9,
  },
  constraints_preserved: [], requested_approvals: [], risks: [],
};

const mock: GenerateJsonFn = async () => ({
  ok: true, content: "", json: GOOD_STRATEGY, provider: "anthropic", model: "claude-test", latencyMs: 3,
} as GenerateResult);

// ---- enablement ------------------------------------------------------------

Deno.test("B1 DISABLED by default — no flag, no allow-list", () => {
  assertEquals(isClaudeFirstLeadPlanningEnabled(WS, () => undefined),
    { enabled: false, reason: "flag_off" });
});

Deno.test("B2 the flag ALONE cannot enable it — there is no global switch", () => {
  const d = isClaudeFirstLeadPlanningEnabled(WS, env({ CLAUDE_FIRST_LEAD_PLANNING: "true" }));
  assertEquals(d, { enabled: false, reason: "no_workspace_allowlist" },
    "flipping one variable must never enable planning everywhere");
});

Deno.test("B3 an allow-list ALONE cannot enable it either", () => {
  const d = isClaudeFirstLeadPlanningEnabled(WS, env({ [CLAUDE_FIRST_WORKSPACES_ENV]: WS }));
  assertEquals(d, { enabled: false, reason: "flag_off" });
});

Deno.test("B4 a workspace outside the allow-list stays disabled", () => {
  const d = isClaudeFirstLeadPlanningEnabled("some-other-workspace", env({
    CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS,
  }));
  assertEquals(d, { enabled: false, reason: "workspace_not_allowed" });
});

Deno.test("B5 BOTH conditions enable exactly the named workspace", () => {
  const reader = env({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: `${WS}, other-ws` });
  assertEquals(isClaudeFirstLeadPlanningEnabled(WS, reader), { enabled: true, reason: "enabled" });
  assertEquals(isClaudeFirstLeadPlanningEnabled("other-ws", reader), { enabled: true, reason: "enabled" });
  assertEquals(isClaudeFirstLeadPlanningEnabled("third-ws", reader).enabled, false);
});

Deno.test("B6 a wildcard is NOT a wildcard — it is just an unmatched name", () => {
  const d = isClaudeFirstLeadPlanningEnabled(WS, env({
    CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: "*",
  }));
  assertEquals(d.enabled, false, "there must be no way to express 'all workspaces'");
});

Deno.test("B7 a typo'd flag value keeps it disabled", () => {
  for (const v of ["yes", "on", "TRUE!", "2", ""]) {
    assertEquals(
      isClaudeFirstLeadPlanningEnabled(WS, env({ CLAUDE_FIRST_LEAD_PLANNING: v, [CLAUDE_FIRST_WORKSPACES_ENV]: WS })).enabled,
      false, `"${v}" must not enable`,
    );
  }
});

// ---- behavior preservation --------------------------------------------------

Deno.test("B8 DISABLED: the spec is returned BY REFERENCE and no model is contacted", async () => {
  const original = spec();
  let called = false;
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: original,
    environment: "test", missionId: "m", readEnv: () => undefined,
    generate: async () => { called = true; throw new Error("must not be reached"); },
  });
  assertFalse(called, "a model was contacted while disabled");
  assertStrictEquals(r.spec, original, "the disabled path must not even copy the spec");
  assertEquals(r.outcome, null, "no planning work is performed at all");
  assertEquals(r.mission, null);
  assertEquals(r.enablement.reason, "flag_off");
});

Deno.test("B9 ENABLED: only keyword_queries change; everything else passes through", async () => {
  const original = spec();
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: original,
    environment: "test", missionId: "m", generate: mock,
    readEnv: env({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }),
  });

  assertEquals(r.outcome?.source, "claude", `fallback: ${r.outcome?.fallbackReason}`);
  assertEquals(r.spec.keyword_queries.sort(), ["GTM Operations", "Revenue Operations", "Sales Operations"]);

  // The dimensions a planner must never redefine.
  assertEquals(r.spec.requested_person_roles, original.requested_person_roles);
  assertEquals(r.spec.location, original.location);
  assertEquals(r.spec.country, original.country);
  assertEquals(r.spec.company_vertical, original.company_vertical);
  assertEquals(r.spec.original_query, PRIMARY);
});

Deno.test("B10 a planner FAILURE leaves the deterministic spec untouched", async () => {
  const original = spec();
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: original,
    environment: "test", missionId: "m",
    generate: async () => ({ ok: false, content: "", provider: "none", model: "", errorCode: "boom", latencyMs: 1 } as GenerateResult),
    readEnv: env({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }),
  });
  assertStrictEquals(r.spec, original, "a failed plan must not rewrite the spec");
  assertEquals(r.outcome?.source, "deterministic_registry");
});

Deno.test("B11 the person roles are never overwritten by hiring-role titles", async () => {
  const original = spec();
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: original,
    environment: "test", missionId: "m", generate: mock,
    readEnv: env({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }),
  });
  assertEquals(r.spec.requested_person_roles, ["Founder", "Co-Founder", "CEO"]);
  for (const role of r.spec.requested_person_roles) {
    assertFalse(r.spec.keyword_queries.includes(role),
      `${role} is a person to contact, never a hiring keyword`);
  }
});

// ---- diagnostics ------------------------------------------------------------

Deno.test("B12 disabled diagnostics are honest and carry no planner fields", async () => {
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
    environment: "test", missionId: "m", readEnv: () => undefined,
  });
  const d = bridgeDiagnostics(r);
  assertEquals(d.planner_source, "deterministic_registry");
  assertEquals(d.claude_first_enabled, false);
  assertEquals(d.enablement_reason, "flag_off");
  assertFalse("model" in d, "a run that never planned must not report a model");
});

Deno.test("B13 enabled diagnostics carry hashes, not content", async () => {
  const r = await applyClaudeFirstLeadPlanning({
    workspaceId: WS, originalInstruction: PRIMARY, spec: spec(),
    environment: "test", missionId: "m", generate: mock,
    readEnv: env({ CLAUDE_FIRST_LEAD_PLANNING: "true", [CLAUDE_FIRST_WORKSPACES_ENV]: WS }),
  });
  const d = bridgeDiagnostics(r);
  assertEquals(d.planner_source, "claude");
  assertEquals(d.model, "claude-test");
  assert(String(d.plan_hash).length > 0);
  assert(String(d.input_hash).length > 0);
  assertEquals(d.selected_capabilities, ["contact_enrichment", "jobs_search"]);

  const blob = JSON.stringify(d);
  assertFalse(blob.includes(PRIMARY), "the instruction must not be echoed into diagnostics");
  assertFalse(blob.includes("<mission>"));
  for (const marker of ["api_key", "Bearer", "harvestapi/"]) {
    assertFalse(blob.includes(marker), `diagnostics leaked ${marker}`);
  }
});
