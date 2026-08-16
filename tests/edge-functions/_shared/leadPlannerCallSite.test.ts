// ONE PLANNER CALL SITE — PROVEN BY COUNTING INVOCATIONS, NOT BY READING SOURCE.
//
// The companion file `leadOwnershipInvariants.test.ts` proves ownership through
// the pure selector and through source-shape assertions. Those are necessary and
// not sufficient: a selector can name one owner while the runtime still calls two
// adapters, which is exactly the state this consolidation started from.
//
// So these tests drive the real call site with both model seams injected and
// COUNT how many times each adapter actually reaches a model. The number that
// matters is never "how many were eligible" — it is how many ran.
//
// Offline. Both model seams are stubs; no gateway, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planQualifiedLeadBeforePersistence,
} from "../../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts";
import {
  loadAuthoritativeLeadPlan,
} from "../../../supabase/functions/_shared/intelligence/leads/leadPlanAuthority.ts";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const LEAD_REQUEST = "Find 10 founders at B2B SaaS companies currently hiring sales";
const NON_LEAD_REQUEST = "write me a linkedin post about outbound";

/** A Company Brain read that fails, so the planner runs without ICP context. */
const admin = {
  from() { throw new Error("no database in this test"); },
} as never;

/**
 * Model requests per adapter, and which adapters were ENTERED.
 *
 * These are different numbers and the distinction matters. The GPT adapter
 * escalates internally — Luna, then Terra at most once — so one adapter can make
 * two model requests. That is one planner doing its own documented fallback, not
 * two planners. The invariant under test is "how many ADAPTERS ran", so
 * `entered` is what the assertions use; `requests` is kept because a change in
 * escalation behaviour is worth seeing rather than silently absorbing.
 */
interface Counters { gpt: number; claude: number; entered: Set<string> }

/**
 * Run the one call site with both adapters stubbed and counted.
 *
 * `readEnv` is injected rather than mutating process env, so flag combinations
 * are exercised without global state and without the two adapters' real gates
 * ever consulting `Deno.env`.
 */
async function planWithCounters(opts: {
  gptEnabled: boolean;
  claudeEnabled: boolean;
  instruction?: string;
  /** Make the selected adapter's model fail, to test fallback ownership. */
  failModel?: boolean;
  /** Withhold the project ref, so an adapter that fails closed does so. */
  recogniseProject?: boolean;
}): Promise<{ counters: Counters; outcome: Awaited<ReturnType<typeof planQualifiedLeadBeforePersistence>> }> {
  const counters: Counters = { gpt: 0, claude: 0, entered: new Set<string>() };

  // The Claude adapter resolves the running project before it will plan and
  // fails closed on an unrecognised one — an unknown project is not a licence to
  // guess. TEST's ref is supplied so the adapter actually reaches its model seam
  // and these counts mean something. Read only; nothing connects to it.
  const env: Record<string, string> = opts.recogniseProject === false
    ? {}
    : { SUPABASE_PROJECT_ID: "ohsdatpvfdjdemstoiuj" };
  if (opts.gptEnabled) {
    env.GPT_LEAD_STRATEGY = "true";
    env.GPT_LEAD_STRATEGY_WORKSPACES = WORKSPACE;
  }
  if (opts.claudeEnabled) {
    env.CLAUDE_FIRST_LEAD_PLANNING = "true";
    env.CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES = WORKSPACE;
  }

  const outcome = await planQualifiedLeadBeforePersistence({
    admin,
    workspaceId: WORKSPACE,
    userInstruction: opts.instruction ?? LEAD_REQUEST,
    readEnv: (k) => env[k],
    callModel: (_call) => {
      counters.gpt++;
      counters.entered.add("gpt");
      if (opts.failModel) return Promise.reject(new Error("model unavailable"));
      // A well-formed-but-rejected plan still counts as one invocation, which is
      // all these tests assert. Validation belongs to the adapter.
      return Promise.resolve({ ok: false, errorCode: "stubbed", provider: "test", latencyMs: 1 } as never);
    },
    generate: (_args) => {
      counters.claude++;
      counters.entered.add("claude");
      if (opts.failModel) return Promise.reject(new Error("model unavailable"));
      return Promise.resolve({ ok: false, error: "stubbed" } as never);
    },
  });

  return { counters, outcome };
}

// ═══ EXACTLY ONE PLANNER INVOCATION ════════════════════════════════════════

Deno.test("one invocation: every flag combination invokes at most one adapter", async () => {
  for (const gptEnabled of [false, true]) {
    for (const claudeEnabled of [false, true]) {
      const { counters } = await planWithCounters({ gptEnabled, claudeEnabled });
      assert(counters.entered.size <= 1,
        `gpt=${gptEnabled} claude=${claudeEnabled} entered ${[...counters.entered].join("+")}; ` +
        `at most one adapter may run`);
    }
  }
});

Deno.test("one invocation: GPT enabled alone invokes GPT once and Claude never", async () => {
  const { counters } = await planWithCounters({ gptEnabled: true, claudeEnabled: false });
  assertEquals([...counters.entered], ["gpt"]);
  assertEquals(counters.claude, 0, "Claude must make no model request at all");
});

Deno.test("one invocation: Claude enabled alone invokes Claude once and GPT never", async () => {
  const { counters } = await planWithCounters({ gptEnabled: false, claudeEnabled: true });
  assertEquals([...counters.entered], ["claude"]);
  assertEquals(counters.gpt, 0, "GPT must make no model request at all");
});

Deno.test("one invocation: BOTH flags on still invokes exactly one adapter", async () => {
  // THE OVERLAP THAT USED TO RUN TWO PLANNERS. Before consolidation, orchestrate
  // planned with Claude (its gate was Claude-only) while run-agent's selector
  // designated GPT — so the designated owner was silently overruled, and on a
  // resume without the artifact both could reach a model for one logical task.
  const { counters, outcome } = await planWithCounters({ gptEnabled: true, claudeEnabled: true });
  assertEquals([...counters.entered], ["gpt"], "GPT owns the gated path when both are eligible");
  assertEquals(counters.claude, 0, "the losing adapter must be recorded, not run");
  assertEquals(outcome?.artifact.planning_owner, "gpt_lead_strategy_v1");
});

Deno.test("one invocation: Claude fails closed on an unrecognised project, without falling through", async () => {
  // Failing closed is correct — an unknown project is not a licence to plan. What
  // matters for ownership is that failing closed does NOT hand the task to GPT.
  const { counters, outcome } = await planWithCounters({
    gptEnabled: true, claudeEnabled: true, recogniseProject: false,
  });
  assertEquals(counters.claude, 0, "Claude declines before reaching its model");
  assertEquals(outcome?.artifact.planning_owner, "gpt_lead_strategy_v1",
    "the selector still names exactly one owner");
});

Deno.test("one invocation: no flags on invokes nothing and declines", async () => {
  const { counters, outcome } = await planWithCounters({ gptEnabled: false, claudeEnabled: false });
  assertEquals(counters.entered.size, 0);
  assertEquals(outcome, null,
    "a workspace with no adapter enabled must keep the plan orchestrate already built");
});

// ═══ ADAPTER FAILURE DOES NOT TRANSFER OWNERSHIP ═══════════════════════════

Deno.test("adapter failure: a failing GPT never hands the task to Claude", async () => {
  // The original defect, at the level that matters: GPT throwing, timing out or
  // having its plan rejected is an ORDINARY outcome. It must resolve to the
  // deterministic ladder, never to a second model.
  const { counters, outcome } = await planWithCounters({
    gptEnabled: true, claudeEnabled: true, failModel: true,
  });
  assertEquals(counters.claude, 0, "Claude must not pick up a failed GPT task");
  assert(counters.gpt >= 1, "GPT must have been the adapter that ran");
  assertEquals(outcome?.artifact.plan_source, "deterministic_registry",
    "a failed adapter falls back deterministically");
  assertEquals(outcome?.artifact.planning_owner, "gpt_lead_strategy_v1",
    "ownership stays with the adapter that was selected, even when it fell back");
});

// ═══ PROVENANCE ════════════════════════════════════════════════════════════

Deno.test("provenance: the artifact answers who planned it and when", async () => {
  const { outcome } = await planWithCounters({ gptEnabled: false, claudeEnabled: true });
  const a = outcome?.artifact;
  assert(a, "a planned task must produce an artifact");
  assertEquals(a!.planning_owner, "claude_lead_planner_v1");
  assert(typeof a!.planned_at === "string" && !Number.isNaN(Date.parse(a!.planned_at!)),
    "planned_at must be a real timestamp");
  assert("plan_source" in a!, "the artifact must record which adapter produced the plan");
  assert("contract" in a!, "the artifact must carry the contract that was planned against");
});

// ═══ NON-LEAD REGRESSION ═══════════════════════════════════════════════════

Deno.test("non-lead: a non-lead request invokes no planner and declines", async () => {
  const { counters, outcome } = await planWithCounters({
    gptEnabled: true, claudeEnabled: true, instruction: NON_LEAD_REQUEST,
  });
  assertEquals(counters.entered.size, 0,
    "a non-lead request must not reach a lead-planning adapter even with both flags on");
  assertEquals(outcome, null, "non-lead orchestration must be untouched");
});

// ═══ RESUME DOES NOT RE-PLAN ═══════════════════════════════════════════════

const PLANNED_ARTIFACT = {
  version: "qualified-lead-visible-plan-1.0.0",
  plan_source: "claude_validated",
  strategy: null,
  strategy_hash: "hash-1",
  approved_titles: ["Head of Sales", "VP Sales"],
  contract: {
    requestedCount: 10, decisionMakerRoles: ["Founder"], hiringRoles: ["Head of Sales"],
    companyVertical: "b2b_saas", companyStage: null, geography: null,
    currentEmployerRequired: true,
  },
  fallback_reason: null,
  planner: { model: "claude-x", model_requests: 1 },
  planning_owner: "claude_lead_planner_v1",
};

Deno.test("resume: a continuation with no body artifact loads the persisted plan", async () => {
  // THE RESUME WINDOW. A continuation's body is rebuilt from a token and carries
  // no artifact. A body-only read returned null, the selector saw
  // `hasPersistedPlan: false`, and the task planned again — with whichever
  // adapter the flags selected, not the one that produced the approved plan.
  let rowReads = 0;
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: null,
    planId: "plan-1",
    readPlanSteps: (id) => {
      rowReads++;
      assertEquals(id, "plan-1");
      return Promise.resolve([
        { metadata: {} },
        { metadata: { qualified_lead_plan: PLANNED_ARTIFACT } },
      ]);
    },
  });

  assertEquals(rowReads, 1, "the persisted plan row must be consulted");
  assertEquals(loaded.source, "persisted_plan_row");
  assertEquals(loaded.artifact?.planning_owner, "claude_lead_planner_v1");
  assertEquals(loaded.artifact?.approved_titles, ["Head of Sales", "VP Sales"],
    "the resumed run must execute the SAME titles the first run planned");
  assertEquals(loaded.missing_reason, null);
});

Deno.test("resume: the body artifact wins and the row is not read", async () => {
  let rowReads = 0;
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: PLANNED_ARTIFACT,
    planId: "plan-1",
    readPlanSteps: () => { rowReads++; return Promise.resolve(null); },
  });
  assertEquals(loaded.source, "request_body");
  assertEquals(rowReads, 0, "a present artifact must not cost a database read");
});

Deno.test("resume: an unplanned task reports absence rather than planning", async () => {
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: null,
    planId: "plan-2",
    readPlanSteps: () => Promise.resolve([{ metadata: {} }]),
  });
  assertEquals(loaded.artifact, null);
  assertEquals(loaded.source, "absent");
  assertEquals(loaded.missing_reason, "no_artifact_on_plan_row",
    "the reason must be explicit — an unexplained null is what triggered re-planning");
});

Deno.test("resume: a failed plan-row read is explicit, never 'never planned'", async () => {
  // A read failure and a genuinely unplanned task are different states. Conflating
  // them is what would let a transient database error re-open re-planning.
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: null,
    planId: "plan-3",
    readPlanSteps: () => Promise.reject(new Error("connection reset")),
  });
  assertEquals(loaded.artifact, null);
  assert(loaded.missing_reason?.startsWith("plan_row_read_failed:"),
    `a read failure must say so, got: ${loaded.missing_reason}`);
});

Deno.test("resume: a task with no plan id is reported, not planned around", async () => {
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: null, planId: null,
    readPlanSteps: () => Promise.reject(new Error("must not be called")),
  });
  assertEquals(loaded.missing_reason, "no_plan_id_on_request");
});

Deno.test("resume: a version mismatch is not silently accepted as a plan", async () => {
  const loaded = await loadAuthoritativeLeadPlan({
    bodyArtifact: null,
    planId: "plan-4",
    readPlanSteps: () => Promise.resolve([
      { metadata: { qualified_lead_plan: { ...PLANNED_ARTIFACT, version: "some-older-version" } } },
    ]),
  });
  assertEquals(loaded.artifact, null,
    "an artifact from an incompatible contract must not be executed as though current");
});

// ═══ FLAG SEMANTICS ════════════════════════════════════════════════════════

Deno.test("flags: both planner gates now accept exactly the same value set", async () => {
  const { isGptLeadStrategyEnabled } = await import(
    "../../../supabase/functions/_shared/leadStrategyBridge.ts");
  const { isClaudeFirstLeadPlanningEnabled } = await import(
    "../../../supabase/functions/_shared/intelligence/leads/leadPlanningBridge.ts");

  const enabling = ["true", "1", "enabled", "TRUE", " true "];
  const notEnabling = ["yes", "on", "2", "", "false", "TRUE!"];

  for (const v of enabling) {
    const env: Record<string, string> = {
      GPT_LEAD_STRATEGY: v, GPT_LEAD_STRATEGY_WORKSPACES: WORKSPACE,
      CLAUDE_FIRST_LEAD_PLANNING: v, CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES: WORKSPACE,
    };
    const read = (k: string) => env[k];
    assertEquals(isGptLeadStrategyEnabled(WORKSPACE, read).enabled, true, `gpt should accept ${v}`);
    assertEquals(isClaudeFirstLeadPlanningEnabled(WORKSPACE, read).enabled, true, `claude should accept ${v}`);
  }

  // `yes` and `on` used to enable the GPT gate and never the Claude one. One
  // system, two definitions of "enabled", is what this normalization removed.
  for (const v of notEnabling) {
    const env: Record<string, string> = {
      GPT_LEAD_STRATEGY: v, GPT_LEAD_STRATEGY_WORKSPACES: WORKSPACE,
      CLAUDE_FIRST_LEAD_PLANNING: v, CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES: WORKSPACE,
    };
    const read = (k: string) => env[k];
    assertEquals(isGptLeadStrategyEnabled(WORKSPACE, read).enabled, false, `gpt must reject ${v}`);
    assertEquals(isClaudeFirstLeadPlanningEnabled(WORKSPACE, read).enabled, false, `claude must reject ${v}`);
  }
});

Deno.test("flags: an allow-list is still required — a flag alone enables nothing", async () => {
  const { isGptLeadStrategyEnabled } = await import(
    "../../../supabase/functions/_shared/leadStrategyBridge.ts");
  const read = (k: string) => ({ GPT_LEAD_STRATEGY: "true" } as Record<string, string>)[k];
  assertEquals(isGptLeadStrategyEnabled(WORKSPACE, read).enabled, false);
  assertEquals(isGptLeadStrategyEnabled(WORKSPACE, read).reason, "no_workspace_allowlist");
});
