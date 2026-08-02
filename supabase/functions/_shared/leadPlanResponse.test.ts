// THE PLAN ANNOUNCED IS THE PLAN PERSISTED.
//
// PR #116 made the validated qualified-Lead plan authoritative for `task_plans`
// and for the run-agent kickoff, and left orchestrate's HTTP RESPONSE returning
// the generic template built beforehand. pilot-chat announces from the response,
// so production run `4ec43c1d-f2fc-4131-9b01-a60b608abca9` (2026-07-28 16:19:11Z)
// persisted the correct four-step plan at 16:19:11.240 and told the user
//
//   "I created a 2-step plan: Scout will source signals via apify, Aria will
//    rank signals."
//
// at 16:19:11.900 — 660ms later, from the same request.
//
// OFFLINE ONLY. The model is injected in every test; no Actor, Firecrawl, live
// model or database is touched.

import { assert, assertEquals, assertFalse, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOrchestrateResponsePlan, readPlanArtifact,
  type OrchestrateResponsePlan,
} from "./leadPlanAuthority.ts";
import { planQualifiedLeadBeforePersistence } from "./leadPlanOrchestration.ts";
import { claudeFirstFromPersistedPlan } from "./leadPlanningBridge.ts";
import type { EnvReader } from "../intelligenceFlags.ts";
import type { GenerateOpts, GenerateResult } from "../../aiProvider.ts";

const CANONICAL =
  "Find 5 founders or CEOs of early-stage B2B SaaS companies in the United States "
  + "that are currently hiring for Sales Operations, Revenue Operations, or GTM Operations roles.";

const WS = "11111111-1111-1111-1111-555555555555";

// The production project, because this reproduces a production run. The planner
// fails closed on an unresolvable environment, so the URL is not optional.
const on: EnvReader = (k) =>
  k === "CLAUDE_FIRST_LEAD_PLANNING" ? "true"
    : k === "CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES" ? WS
    : k === "SUPABASE_URL" ? "https://wqnigjhcwjxtmordrwno.supabase.co"
    : undefined;
const off: EnvReader = () => undefined;

const noBrain = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
  }),
} as never;

interface Mock { fn: (o: GenerateOpts) => Promise<GenerateResult>; calls: GenerateOpts[] }

/** The strategy production actually produced: valid, but approval-gated. */
const STRATEGY = {
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

function model(): Mock {
  const calls: GenerateOpts[] = [];
  return {
    calls,
    fn: (opts) => {
      calls.push(opts);
      return Promise.resolve({
        ok: true, content: JSON.stringify({ strategy: STRATEGY }), json: { strategy: STRATEGY },
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

/**
 * The generic two-step plan orchestrate builds before it knows the route — the
 * exact shape that reached the user in production.
 */
const LEGACY: OrchestrateResponsePlan = {
  plan_summary: "Source → rank: Sales Operations OR Revenue Operations OR GTM Operations",
  steps: [
    { step_index: 0, agent_slug: "scout", task_title: "source signals via apify", tool_needed: "source_with_apify" },
    { step_index: 1, agent_slug: "aria", task_title: "rank signals", tool_needed: null },
  ],
};

/**
 * pilot-chat's announcement, reproduced verbatim from
 * supabase/functions/pilot-chat/index.ts. This is the renderer that produced the
 * sentence in production, and it is deliberately NOT changed by this fix.
 */
function announce(plan: OrchestrateResponsePlan): string {
  const names: Record<string, string> = { scout: "Scout", aria: "Aria", penn: "Penn", hawk: "Hawk", scribe: "Scribe" };
  const chain = plan.steps
    .map((s) => `${names[s.agent_slug] ?? s.agent_slug} will ${(s.task_title || "").toString().toLowerCase() || "work the step"}`)
    .join(", ");
  return `I created a ${plan.steps.length}-step plan: ${chain}.`;
}

/** The authoritative plan, planned exactly as orchestrate plans it. */
async function authoritative(m: Mock = model()) {
  const out = await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m.fn, readEnv: on,
  });
  assert(out, "an eligible qualified-Lead mission must produce a plan");
  return { out, m };
}

// ============================================ 1./2./4. the authority wins ====

Deno.test("1. the authoritative plan wins over the generic parsed plan", async () => {
  const { out } = await authoritative();
  const response = buildOrchestrateResponsePlan(out, LEGACY);

  assertEquals(response.plan_summary, out.summary);
  assertFalse(response.plan_summary === LEGACY.plan_summary);

  // The production symptom, gone: the announcement now describes the mission.
  const sentence = announce(response);
  assertFalse(sentence.includes("2-step plan"), sentence);
  assertFalse(sentence.toLowerCase().includes("source signals via apify"), sentence);
  assertFalse(sentence.toLowerCase().includes("rank signals"), sentence);
});

Deno.test("2. the returned step count comes from the authoritative steps", async () => {
  const { out } = await authoritative();
  const response = buildOrchestrateResponsePlan(out, LEGACY);

  assertEquals(response.steps.length, out.steps.length);
  assertEquals(response.steps.length, 4);
  // total_steps / steps_count in orchestrate's response are this same length, so
  // the "2-step plan" wording is unreachable for a qualified-Lead mission.
  assert(announce(response).startsWith("I created a 4-step plan:"), announce(response));
});

Deno.test("3. every authoritative step exposes its description as task_title", async () => {
  const { out } = await authoritative();
  const response = buildOrchestrateResponsePlan(out, LEGACY);

  assertEquals(
    response.steps.map((s) => s.task_title),
    out.steps.map((s) => s.description),
  );
  // No step may fall through to pilot-chat's "work the step" placeholder.
  for (const step of response.steps) {
    assert(typeof step.task_title === "string" && step.task_title.length > 0);
  }
  assertFalse(announce(response).includes("work the step"), announce(response));

  // Mapping ADDS task_title; it never drops what the step already carried.
  assertEquals(response.steps[0].description, out.steps[0].description);
  assertEquals(response.steps[0].instruction, out.steps[0].instruction);
  assertEquals(response.steps[0].tool_needed, "source_with_apify");
});

Deno.test("4. the agent list comes from the authoritative steps", async () => {
  const { out } = await authoritative();
  const response = buildOrchestrateResponsePlan(out, LEGACY);

  const agents = response.steps.map((s) => s.agent_slug);
  assertEquals(agents, out.steps.map((s) => s.agent_slug));
  assertEquals(agents, ["scout", "scout", "scout", "aria"]);
  // Not the legacy pair, which is what activity_feed and the response recorded.
  assertFalse(agents.length === LEGACY.steps.length);
});

// ================================== 5. deterministic provenance stays visible ==

Deno.test("5. a withheld Claude strategy is announced as the deterministic plan, with its reason", async () => {
  const { out } = await authoritative();

  // Claude answered; the strategy was withheld and the deterministic plan became
  // authoritative. This fixture is withheld by the validator
  // (`validation_blocked:capability_not_allowed`); production run
  // 4ec43c1d was withheld by the approval policy
  // (`approval_required:seniority_change`). Both are deterministic fallbacks and
  // both must announce themselves as such, so the assertion is on the PROVENANCE
  // rather than on any one reason string.
  assertEquals(out.artifact.plan_source, "deterministic_registry");
  assert(out.artifact.fallback_reason, "a fallback must state why");

  const response = buildOrchestrateResponsePlan(out, LEGACY);

  // The user is told the truth rather than shown the generic template.
  assert(response.plan_summary.startsWith("Deterministic plan:"), response.plan_summary);
  assertFalse(response.plan_summary.includes("Claude-planned"));
  // The reason travels with the step the user can inspect.
  const artifact = readPlanArtifact(response.steps);
  assert(artifact, "provenance must survive the response mapping");
  assertEquals(artifact.plan_source, "deterministic_registry");
  assertEquals(artifact.fallback_reason, out.artifact.fallback_reason);
  // And it is rendered into the step the user reads, not only into metadata.
  assert(
    response.steps.some((s) => String(s.instruction ?? "").includes(artifact.fallback_reason!)),
    "the fallback reason must be visible on a step",
  );
});

Deno.test("5b. production's approval-gated provenance renders the same way", () => {
  // The exact artifact production persisted for run 4ec43c1d, replayed through
  // the response builder to prove the approval flavour is announced honestly.
  const out = {
    summary: "Deterministic plan: 5 CONTACT-ready Founder, Co-Founder or CEO at saas companies in United States hiring Sales Operations, Revenue Operations or GTM Operations.",
    steps: [{
      step_index: 0, agent_slug: "scout",
      description: "Find companies hiring Sales Operations, Revenue Operations or GTM Operations",
      instruction: "…\n\nDeterministic approved sources (approval_required:seniority_change).",
      expected_output: "x", success_criteria: "y", requires_approval: false,
    }],
  };

  const response = buildOrchestrateResponsePlan(out, LEGACY);
  assert(response.plan_summary.startsWith("Deterministic plan:"));
  assertEquals(response.steps[0].task_title, out.steps[0].description);
  assert(String(response.steps[0].instruction).includes("approval_required:seniority_change"));
  // The generic template is gone even though Claude authored nothing.
  assertFalse(announce(response).toLowerCase().includes("rank signals"));
});

// ==================================================== 6./7. nothing else moves ==

Deno.test("6. with no authoritative plan the caller's own plan is returned, by reference", () => {
  for (const absent of [null, undefined]) {
    const response = buildOrchestrateResponsePlan(absent, LEGACY);
    // Identity, not deep equality: legacy behaviour is unchanged, not re-derived.
    assertStrictEquals(response, LEGACY);
    assertEquals(announce(response), "I created a 2-step plan: Scout will source signals via apify, Aria will rank signals.");
  }
});

Deno.test("7. generic non-Lead workflows are untouched end to end", async () => {
  // Not a qualified-Lead mission — the seam declines, so the response is legacy.
  const m1 = forbidden();
  const notLead = await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: "Draft a LinkedIn post about RevOps.",
    generate: m1.fn, readEnv: on,
  });
  assertEquals(notLead, null);
  assertStrictEquals(buildOrchestrateResponsePlan(notLead, LEGACY), LEGACY);
  assertEquals(m1.calls.length, 0);

  // A qualified-Lead mission in a workspace that has NOT opted in: same result.
  const m2 = forbidden();
  const notEnabled = await planQualifiedLeadBeforePersistence({
    admin: noBrain, workspaceId: WS, userInstruction: CANONICAL, generate: m2.fn, readEnv: off,
  });
  assertEquals(notEnabled, null);
  assertStrictEquals(buildOrchestrateResponsePlan(notEnabled, LEGACY), LEGACY);
  assertEquals(m2.calls.length, 0);
});

// ============================ 8./9. one planner call, and run-agent reuses it ==

Deno.test("8. building the response costs no additional planner request", async () => {
  const m = model();
  const { out } = await authoritative(m);
  assertEquals(m.calls.length, 1, "orchestrate plans exactly once");

  buildOrchestrateResponsePlan(out, LEGACY);
  buildOrchestrateResponsePlan(out, LEGACY);

  // Rendering the response is pure — the count cannot move.
  assertEquals(m.calls.length, 1);
  assertEquals(out.artifact.planner?.model_requests, 1);
});

Deno.test("9. run-agent still reuses the persisted strategy, planning nothing again", async () => {
  const m = model();
  const { out } = await authoritative(m);
  const response = buildOrchestrateResponsePlan(out, LEGACY);

  // The artifact run-agent consumes is readable off the persisted steps AND off
  // the response steps — the mapping preserves step[0].metadata.
  const fromPersisted = readPlanArtifact(out.steps);
  const fromResponse = readPlanArtifact(response.steps);
  assert(fromPersisted && fromResponse);
  assertEquals(fromResponse, fromPersisted);

  const spec = { keyword_queries: ["Sales Operations"], original_query: CANONICAL };
  const reused = claudeFirstFromPersistedPlan(fromPersisted, spec);

  // Deterministic provenance is carried through, and run-agent records that it
  // made no request of its own.
  assertEquals(reused.outcome?.source, "deterministic_registry");
  assertEquals(reused.outcome?.diagnostics.model_requests, 0);
  assertEquals(reused.specRewritten, false);
  // Still exactly one Anthropic request for the whole run.
  assertEquals(m.calls.length, 1);
});
