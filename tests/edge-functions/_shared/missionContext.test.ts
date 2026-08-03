// MISSION CONTEXT — tenant isolation, secret removal, bounding, determinism.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionContext, emptyMissionContext, bounded, stripSecrets, looksLikeSecret,
  contextSize, withinPromptBudget, CONTEXT_LIMITS,
} from "../../../supabase/functions/_shared/intelligence/missionContext.ts";
import type { CanonicalCompanyBrain } from "../../../supabase/functions/_shared/getCompiledCompanyBrainForWorkspace.ts";

function brain(overrides: Record<string, unknown> = {}): CanonicalCompanyBrain {
  return {
    workspace_id: "ws-1",
    company_summary: { name: "Agentory", description: "AI GTM workforce" },
    target_customer: {
      industries: ["B2B SaaS", "Fintech"], business_models: ["subscription"],
      company_size: { min: 10, max: 200 }, geography: ["United States"],
      categories: ["sales tech"], maturity_stage: ["seed"], segments: ["founder-led"],
    },
    buyer_personas: [{ role: "Founder" }, { role: "CEO" }],
    pain_points: ["manual prospecting"],
    triggers: [{ label: "hiring sales ops" }],
    jobs_to_watch: [],
    disqualifiers: [{ label: "manufacturing" }],
    positive_examples: [], negative_examples: [],
    competitors: ["Clay"], tools: [],
    positioning: { promise: "passive talent discovery", proof_themes: ["case study"], ctas: [], banned_claims: ["guaranteed"] },
    brand_voice: { voice_notes: [], banned_claims: [] },
    content_angles: ["evidence-first"],
    qualification_rules: { required_evidence: ["employer_verified"], reject_if: ["no website"], manual_review_if: ["ambiguous size"] },
    setup_required: false,
    brain_confidence: 0.8,
    missing_fields: [], warnings: [],
    query_strategy: {},
    legacy_icp: {},
    compiled: { source_ids: ["src-a", "src-b"] },
    normalized: {},
    completeness: {},
    ...overrides,
  } as unknown as CanonicalCompanyBrain;
}

// ---- tenant isolation ------------------------------------------------------

Deno.test("4.A a brain from ANOTHER workspace is never projected", () => {
  const foreign = brain({ workspace_id: "ws-OTHER", company_summary: { name: "SomeoneElse" } });
  const ctx = buildMissionContext("ws-1", foreign);
  assertEquals(ctx.workspace_id, "ws-1");
  assertEquals(ctx.company_brain.company_name, undefined, "a foreign brain must not leak a single field");
  assertEquals(ctx.icp.industries, []);
  assert(ctx.readiness.setup_required);
});

Deno.test("4.B no cross-workspace content survives the projection", () => {
  const ctx = buildMissionContext("ws-1", brain({ workspace_id: "ws-2", competitors: ["SecretCompetitor"] }));
  assertFalse(JSON.stringify(ctx).includes("SecretCompetitor"));
});

// ---- missing brain / missing ICP -------------------------------------------

Deno.test("4.C a missing Company Brain degrades safely", () => {
  const ctx = buildMissionContext("ws-1", null);
  assertEquals(ctx, emptyMissionContext("ws-1"));
  assertFalse(ctx.readiness.brain_present);
  assert(ctx.readiness.setup_required, "a workspace with no brain must be told to set one up");
});

Deno.test("4.D a brain with NO ICP is honest rather than invented", () => {
  const ctx = buildMissionContext("ws-1", brain({
    target_customer: { industries: [], business_models: [], company_size: {}, geography: [], categories: [], maturity_stage: [], segments: [] },
    buyer_personas: [],
  }));
  assert(ctx.readiness.brain_present);
  assertFalse(ctx.readiness.icp_present);
  assert(ctx.readiness.setup_required);
  assertEquals(ctx.icp.industries, [], "an absent ICP must stay empty, never be filled in");
});

// ---- hard vs soft ----------------------------------------------------------

Deno.test("4.E hard constraints and soft preferences stay separate", () => {
  const ctx = buildMissionContext("ws-1", brain());
  assert(ctx.icp.hard_constraints.includes("employer_verified"));
  assert(ctx.icp.hard_constraints.includes("no website"));
  assert(ctx.icp.soft_preferences.includes("ambiguous size"));
  assertFalse(ctx.icp.hard_constraints.includes("ambiguous size"),
    "a manual-review hint is not a hard rule");
});

// ---- secrets ---------------------------------------------------------------

Deno.test("5.A secret-shaped KEYS are removed at any depth", () => {
  const ctx = buildMissionContext("ws-1", brain({
    compiled: { source_ids: ["src-a"], api_key: "sk-live-abcdefghijklmnop", nested: { password: "hunter2" } },
  }));
  const blob = JSON.stringify(ctx);
  assertFalse(blob.includes("sk-live-abcdefghijklmnop"));
  assertFalse(blob.includes("hunter2"));
});

Deno.test("5.B secret-shaped VALUES are removed even under an innocent key", () => {
  const ctx = buildMissionContext("ws-1", brain({
    competitors: ["Clay", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA", "apify_api_ABCDEFGHIJKLMNOP"],
    pain_points: ["contact ops", "AKIAIOSFODNN7EXAMPLE"],
  }));
  const blob = JSON.stringify(ctx);
  assertFalse(blob.includes("sk-ant-api03"));
  assertFalse(blob.includes("apify_api_"));
  assertFalse(blob.includes("AKIAIOSFODNN7EXAMPLE"));
  assert(ctx.company_brain.competitors.includes("Clay"), "legitimate values must survive");
});

Deno.test("5.C looksLikeSecret catches both key-shape and value-shape", () => {
  assert(looksLikeSecret("ANTHROPIC_API_KEY", "x"));
  assert(looksLikeSecret("webhook_url", "x"));
  assert(looksLikeSecret("notes", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"));
  assert(looksLikeSecret("blob", "eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSM"));
  assertFalse(looksLikeSecret("industries", "B2B SaaS"));
});

Deno.test("5.C2 bearer tokens and authorization headers are removed as VALUES", () => {
  // Key-shape detection catches a field NAMED `authorization`. A credential pasted
  // into ordinary free text arrives under an innocent key, so the value shape has
  // to catch it too.
  for (const secret of [
    "Bearer abcdefgh12345678901234",
    "authorization: Bearer abcdefgh12345678",
    "auth_token = abcdefgh12345678",
  ]) {
    assert(looksLikeSecret("pain_points", secret), `not detected: ${secret}`);
    assertEquals(bounded([secret]), [], `not stripped from a list: ${secret}`);
  }
});

Deno.test("5.C3 secret patterns do NOT over-remove ordinary business language", () => {
  // Each of these contains a credential-ish WORD but is legitimate ICP vocabulary.
  const ordinary = [
    "Token Metrics", "Password manager vendors", "Secretarial services",
    "Authorization workflows", "Bearer of record", "API key management platforms",
    "B2B SaaS", "Revenue Operations", "employer_verified",
  ];
  assertEquals(bounded(ordinary).length, ordinary.length,
    `dropped: ${ordinary.filter((o) => !bounded(ordinary).includes(o)).join(", ")}`);
});

Deno.test("5.D stripSecrets preserves structure it does not remove", () => {
  const cleaned = stripSecrets({ keep: ["a"], drop: { api_key: "x" }, deep: { ok: 1, secret: "y" } });
  assertEquals((cleaned as Record<string, unknown>).keep, ["a"]);
  assertEquals((cleaned as Record<string, unknown>).drop, {});
  assertEquals((cleaned as Record<string, unknown>).deep, { ok: 1 });
});

// ---- ordering + bounds -----------------------------------------------------

Deno.test("6.A ordering is deterministic across loads", () => {
  const a = buildMissionContext("ws-1", brain({ competitors: ["Zeta", "alpha", "Mid"] }));
  const b = buildMissionContext("ws-1", brain({ competitors: ["Mid", "Zeta", "alpha"] }));
  assertEquals(a.company_brain.competitors, b.company_brain.competitors,
    "the same brain in a different array order must produce the same context");
  assertEquals(a.company_brain.competitors, ["alpha", "Mid", "Zeta"]);
});

Deno.test("6.B lists are bounded and de-duplicated", () => {
  const many = Array.from({ length: 200 }, (_, i) => `Industry ${i}`);
  const ctx = buildMissionContext("ws-1", brain({
    target_customer: { ...brain().target_customer, industries: [...many, "Industry 0", "INDUSTRY 0"] },
  }));
  assertEquals(ctx.icp.industries.length, CONTEXT_LIMITS.maxListItems);
  const lower = ctx.icp.industries.map((s) => s.toLowerCase());
  assertEquals(new Set(lower).size, lower.length, "no duplicates survive");
});

Deno.test("6.C individual strings are clipped", () => {
  const huge = "x".repeat(5_000);
  const out = bounded([huge]);
  assertEquals(out[0].length, CONTEXT_LIMITS.maxStringLength);
});

Deno.test("6.D the projected context stays inside the prompt budget", () => {
  const huge = Array.from({ length: 500 }, (_, i) => "y".repeat(400) + i);
  const ctx = buildMissionContext("ws-1", brain({
    competitors: huge, pain_points: huge, content_angles: huge,
    target_customer: { ...brain().target_customer, industries: huge, geography: huge, categories: huge },
  }));
  assert(withinPromptBudget(ctx), `context was ${contextSize(ctx)} chars`);
});

Deno.test("6.E the raw brain escape hatches never reach the context", () => {
  const ctx = buildMissionContext("ws-1", brain({
    compiled: { source_ids: ["src-a"], internal_debug: "RAW_DUMP_MARKER" },
    normalized: { everything: "NORMALIZED_MARKER" },
    completeness: { detail: "COMPLETENESS_MARKER" },
  }));
  const blob = JSON.stringify(ctx);
  assertFalse(blob.includes("RAW_DUMP_MARKER"), "compiled must not be passed through");
  assertFalse(blob.includes("NORMALIZED_MARKER"));
  assertFalse(blob.includes("COMPLETENESS_MARKER"));
  assert(ctx.company_brain.source_ids.includes("src-a"), "source ids ARE preserved");
});

// ---- explicit instruction vs ICP -------------------------------------------

Deno.test("7.A a soft ICP preference never becomes a hard constraint", () => {
  const ctx = buildMissionContext("ws-1", brain());
  // "founder-led" is a segment (descriptive), not a qualification rule.
  assert(ctx.icp.soft_preferences.includes("founder-led"));
  assertFalse(ctx.icp.hard_constraints.includes("founder-led"));
});

Deno.test("7.B a hard workspace restriction is carried as hard", () => {
  const ctx = buildMissionContext("ws-1", brain({
    qualification_rules: { required_evidence: ["employer_verified"], reject_if: ["staffing agency"], manual_review_if: [] },
  }));
  assert(ctx.icp.hard_constraints.includes("staffing agency"),
    "a workspace rejection rule must be hard, so no planner can optimize it away");
});
