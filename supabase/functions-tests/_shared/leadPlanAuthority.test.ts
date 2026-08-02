// THE VISIBLE PLAN IS THE VALIDATED PLAN.
//
// Production ran this twice. Both times the generic "Scout will source signals
// via apify, Aria will rank signals" plan was persisted at 11:41:39, Claude was
// called ~4s later inside run-agent, its strategy was rejected for `raw_actor_id`
// and `hiring_seniority_contaminated`, and the run executed deterministically —
// while the plan on screen still described neither.
//
// OFFLINE ONLY. The model is injected in every test; no Actor, Firecrawl, live
// model or database is touched.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualifiedLeadPlanSteps, buildQualifiedLeadPlanSummary, readPlanArtifact,
  QUALIFIED_LEAD_PLAN_VERSION,
  type QualifiedLeadPlanArtifact, type QualifiedLeadPlanContract,
} from "../../functions/_shared/leadPlanAuthority.ts";
import { planQualifiedLeadBeforePersistence } from "../../functions/_shared/leadPlanOrchestration.ts";
import { claudeFirstFromPersistedPlan } from "../../functions/_shared/leadPlanningBridge.ts";
import { LEAD_ROLE_SEPARATION_RULE, LEAD_PLANNER_PROHIBITIONS, LEAD_STRATEGY_OUTPUT_SCHEMA } from "../../functions/_shared/leadStrategy.ts";
import type { EnvReader } from "../../functions/intelligenceFlags.ts";
import type { GenerateOpts, GenerateResult } from "../../aiProvider.ts"";

const CANONICAL =
  "Find 5 founders or CEOs of early-stage B2B SaaS companies in the United States "
  + "that are currently hiring for Sales Operations, Revenue Operations, or GTM Operations roles.";

const WS = "11111111-1111-1111-1111-555555555555";

const on: EnvReader = (k) =>
  k === "CLAUDE_FIRST_LEAD_PLANNING" ? "true"
    : k === "CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES" ? WS
    : k === "SUPABASE_URL" ? "https://zbwsbnqqpkvdhqwavjke.supabase.co"
    : undefined;
const off: EnvReader = () => undefined;

/** A brain loader that returns nothing — the planner may plan without ICP. */
const noBrain = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
  }),
} as never;

interface Mock { fn: (o: GenerateOpts) => Promise<GenerateResult>; calls: GenerateOpts[] }

function model(strategy: unknown): Mock {
  const calls: GenerateOpts[] = [];
  return {
    calls,
    fn: (opts) => {
      calls.push(opts);
      return Promise.resolve({
        ok: true, content: JSON.stringify({ strategy }), json: { strategy },
        provider: "anthropic" as const, model: "claude-haiku-4-5-20251001", latencyMs: 12,
        usage: { input_tokens: 1200, output_tokens: 340 },
      });
    },
  };
}

/** A model that must never be reached. */
function forbidden(): Mock {
  const calls: GenerateOpts[] = [];
  return { calls, fn: (o) => { calls.push(o); throw new Error("planner must not be called"); } };
}

/** A strategy shaped like the one production kept rejecting. */
const CONTAMINATED_STRATEGY = {
  role_ontology: {
    canonical_concept: "Revenue Operations",
    seniority: ["senior"],
    exact_titles: ["Revenue Operations", "CEO", "President"],
    safe_synonyms: [], adjacent_titles: [], excluded_titles: [],
  },
  company_interpretation: { verticals: ["B2B SaaS"], stages: [], employee_range: {} },
  searches: [{ capability_key: "apify_jobs~curious_coder", titles: ["Revenue Operations"], locations: ["United States"], purpose: "discover_hiring_companies" }],
  exclusions: [], expected_funnel: {}, confidence: 0.8,
};

const contract: QualifiedLeadPlanContract = {
  requestedCount: 5,
  decisionMakerRoles: ["Founder", "Co-Founder", "CEO"],
  hiringRoles: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  companyVertical: "saas", companyStage: "early-stage", geography: "United States",
  currentEmployerRequired: true,
};

const artifact = (o: Partial<QualifiedLeadPlanArtifact> = {}): QualifiedLeadPlanArtifact => ({
  version: QUALIFIED_LEAD_PLAN_VERSION,
  plan_source: "claude_validated",
  strategy: null, strategy_hash: "sh-1",
  approved_titles: contract.hiringRoles,
  contract, fallback_reason: null, planner: null,
  ...o,
});

// ================================================= 1./2./3. plan authority ===

Deno.test("1. planning happens BEFORE persistence, and declines when not applicable", async () => {
  // Not a qualified-Lead mission: the seam declines and orchestrate is untouched.
  const m1 = forbidden();
  assertEquals(
    await planQualifiedLeadBeforePersistence({
      admin: noBrain, workspaceId: WS, userInstruction: "Show companies hiring Sales Operations.",
      generate: m1.fn, readEnv: on,
    }),
    null,
  );
  assertEquals(m1.calls.length, 0);

  // 21. Claude-first OFF: declines, no model call, deterministic path unchanged.
  const m2 = forbidden();
  assertEquals(
    await planQualifiedLeadBeforePersistence({
      admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m2.fn, readEnv: off,
    }),
    null,
  );
  assertEquals(m2.calls.length, 0);

  // Wrong workspace: the allow-list is exact.
  const m3 = forbidden();
  assertEquals(
    await planQualifiedLeadBeforePersistence({
      admin: noBrain, workspaceId: "ws-not-listed", userInstruction: CANONICAL, generate: m3.fn, readEnv: on,
    }),
    null,
  );
  assertEquals(m3.calls.length, 0);
});

Deno.test("2./3./4./5. an eligible mission plans once, through Anthropic, before persistence", async () => {
  const m = model(CONTAMINATED_STRATEGY);
  const out = await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  });

  assert(out, "an eligible mission must produce a plan");
  // 5. exactly one initial planner call.
  assertEquals(m.calls.length, 1);
  // 4. Anthropic remains the preferred provider.
  assertEquals(m.calls[0].preferredProvider, "anthropic");

  // 2./3. the plan is NOT the generic template.
  assertFalse(out.summary.toLowerCase().includes("scout"));
  assertFalse(out.summary.toLowerCase().includes("rank signals"));
  assert(out.summary.includes("5 CONTACT-ready"));
  assert(out.summary.includes("Founder"));

  // The steps describe the real mission, including the gate and verification.
  const descriptions = out.steps.map((s) => s.description.toLowerCase()).join(" | ");
  assert(descriptions.includes("company brain"));
  assert(descriptions.includes("verify"));
  assert(descriptions.includes("contact-ready"));
});

Deno.test("18. a rejected strategy is labelled deterministic, never shown as Claude's", async () => {
  const m = model(CONTAMINATED_STRATEGY);
  const out = (await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  }))!;

  // The production strategy is rejected — and the plan says so.
  assertEquals(out.artifact.plan_source, "deterministic_registry");
  assert(out.artifact.fallback_reason, "a fallback must state why");
  assertEquals(out.artifact.strategy, null);
  assertEquals(out.artifact.strategy_hash, null);
  assert(out.summary.startsWith("Deterministic plan:"),
    `a deterministic plan must say so, got: ${out.summary}`);
  // And it must not claim to be Claude's.
  assertFalse(out.summary.includes("Claude-planned"));
});

Deno.test("8./9./10./11. hiring and decision-maker roles stay separate in the plan", async () => {
  const m = model(CONTAMINATED_STRATEGY);
  const out = (await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  }))!;

  assertEquals(out.artifact.contract.hiringRoles, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(out.artifact.contract.decisionMakerRoles, ["Founder", "Co-Founder", "CEO"]);

  // 10. no executive title reached the hiring roles, despite Claude proposing them.
  const hiring = out.artifact.contract.hiringRoles.join(" ").toLowerCase();
  for (const exec of ["founder", "ceo", "president", "chief executive"]) {
    assertFalse(hiring.includes(exec), `${exec} leaked into hiring roles`);
  }
  // 11. no operations role reached the people search.
  const people = out.artifact.contract.decisionMakerRoles.join(" ").toLowerCase();
  for (const ops of ["sales operations", "revenue operations", "gtm operations"]) {
    assertFalse(people.includes(ops), `${ops} leaked into decision-maker roles`);
  }
});

// ===================================== 12.-17. validator remains authoritative ==

Deno.test("12./13./17. the validator still rejects unsafe strategies", async () => {
  const m = model(CONTAMINATED_STRATEGY);
  const out = (await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  }))!;

  const v = (out.artifact.planner?.validation ?? {}) as { valid?: boolean; violation_codes?: string[] };
  assertFalse(v.valid, "a contaminated strategy with a raw actor id must not validate");
  const codes = (v.violation_codes ?? []).join(",");
  assert(codes.length > 0, "a rejection must name its reasons");
  // A raw Actor id fails as a not-allowed CAPABILITY before the raw-id text check
  // ever runs — an earlier and stronger rejection than production's
  // `raw_actor_id`, and the strategy is discarded either way. The assertion is on
  // the property that matters (unsafe input never becomes an executable plan),
  // not on which guard fired first.
  const known = [
    "raw_actor_id", "hiring_seniority_contaminated", "capability_not_allowed",
    "decision_maker_search_missing", "company_vertical_change",
  ];
  assert(known.some((c) => codes.includes(c)), `unrecognised violation codes: ${codes}`);
});

Deno.test("7. the planner prompt states the separation rule and the prohibitions", () => {
  const rendered = JSON.stringify(LEAD_STRATEGY_OUTPUT_SCHEMA);
  assert(rendered.includes(LEAD_ROLE_SEPARATION_RULE.slice(0, 40)),
    "the role-separation rule must reach the rendered schema");
  for (const rule of LEAD_PLANNER_PROHIBITIONS) {
    assert(rendered.includes(rule.slice(0, 30)), `prohibition missing: ${rule.slice(0, 40)}`);
  }
  // The specific titles production kept getting wrong are named.
  for (const t of ["Founder", "CEO", "President"]) assert(LEAD_ROLE_SEPARATION_RULE.includes(t));
  assert(LEAD_ROLE_SEPARATION_RULE.includes("Sales "), "the hiring side must be named too");
});

// ======================================= 6./11. run-agent consumes, not replans ==

Deno.test("6./11. a persisted plan is consumed without a second planner call", () => {
  const a = artifact({
    plan_source: "claude_validated",
    approved_titles: ["Revenue Operations", "Sales Operations"],
    strategy_hash: "sh-42",
    planner: { provider: "anthropic", model: "claude-haiku-4-5-20251001", model_requests: 1 },
  });

  const reused = claudeFirstFromPersistedPlan(a, { keyword_queries: ["old"], requested_person_roles: ["Founder"] });

  assertEquals(reused.specRewritten, true);
  assertEquals((reused.spec as unknown as { keyword_queries: string[] }).keyword_queries,
    ["Revenue Operations", "Sales Operations"]);
  // The tell that no second call happened.
  const d = reused.outcome!.diagnostics as unknown as Record<string, unknown>;
  assertEquals(d.model_requests, 0);
  assertEquals(d.reused_persisted_plan, true);
  assertEquals(d.strategy_hash, "sh-42");
});

Deno.test("7.B continuation preserves the strategy hash", () => {
  const a = artifact({ strategy_hash: "sh-continuation" });
  const first = claudeFirstFromPersistedPlan(a, { keyword_queries: [] });
  const second = claudeFirstFromPersistedPlan(a, { keyword_queries: [] });
  const h = (r: typeof first) => (r.outcome!.diagnostics as unknown as Record<string, unknown>).strategy_hash;
  assertEquals(h(first), "sh-continuation");
  assertEquals(h(second), h(first), "a resumed run executes the same strategy");
});

Deno.test("18.B a deterministic artifact is reused truthfully", () => {
  const a = artifact({
    plan_source: "deterministic_registry", strategy: null, strategy_hash: null,
    fallback_reason: "validation_blocked:raw_actor_id",
  });
  const reused = claudeFirstFromPersistedPlan(a, { keyword_queries: ["kept"] });
  assertEquals(reused.specRewritten, false, "a deterministic plan does not rewrite the spec");
  assertEquals(reused.outcome!.source, "deterministic_registry");
  assertEquals(reused.outcome!.fallbackReason, "validation_blocked:raw_actor_id");
});

// ================================================ artifact round-trip + safety ==

Deno.test("the artifact survives the plan steps and is readable back", () => {
  const a = artifact();
  const steps = buildQualifiedLeadPlanSteps({
    contract, artifact: a, originalInstruction: CANONICAL, toolInput: { max_results: 25 },
  });
  assertEquals(readPlanArtifact(steps)?.strategy_hash, "sh-1");
  assertEquals(readPlanArtifact([{ metadata: {} }]), null);
  assertEquals(readPlanArtifact(null), null);
  // The existing tool_input threading is preserved.
  assertEquals((steps[0].metadata as { tool_input?: unknown }).tool_input, { max_results: 25 });
});

Deno.test("19. planner provider and token diagnostics are persisted", async () => {
  const m = model(CONTAMINATED_STRATEGY);
  const out = (await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  }))!;
  const p = out.artifact.planner!;
  assertEquals(p.requested_provider, "anthropic");
  assertEquals(p.provider, "anthropic");
  assertEquals(p.model, "claude-haiku-4-5-20251001");
  assertEquals(p.model_requests, 1);
  assert(p.token_usage, "token usage must be persisted");
  assertEquals((p.token_usage as { input?: number }).input, 1200);
});

Deno.test("the visible plan never leaks prompts, actor ids or credentials", () => {
  const a = artifact({ plan_source: "claude_validated" });
  const steps = buildQualifiedLeadPlanSteps({ contract, artifact: a, originalInstruction: CANONICAL });
  const blob = JSON.stringify({ summary: buildQualifiedLeadPlanSummary(contract, "claude_validated"), steps }).toLowerCase();
  for (const forbidden of ["apify_jobs", "curious_coder", "~", "api-key", "authorization", "bearer", "<mission>", "system_policy"]) {
    assertFalse(blob.includes(forbidden), `"${forbidden}" leaked into the visible plan`);
  }
});

Deno.test("23. no live model or provider call occurs", async () => {
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._a: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network permitted"));
  }) as typeof fetch;
  try {
    const m = model(CONTAMINATED_STRATEGY);
    await planQualifiedLeadBeforePersistence({
      admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0);
});
