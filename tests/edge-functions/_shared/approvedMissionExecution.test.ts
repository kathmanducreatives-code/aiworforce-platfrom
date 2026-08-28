// FROM THE APPROVED CARD TO THE FIRST PROVIDER BOUNDARY.
//
// ── THE RUN THIS REPRODUCES ────────────────────────────────────────────────
//
// Task bf13ff42, 2026-08-28 15:53. A compiled `LeadMissionV1` was previewed,
// the card rendered, the user pressed Start, and the mission arrived at
// pilot-chat intact — `action_source: lead_intake_card`, `confirmed: true`,
// `metadata.lead_mission` present. It was then handed to orchestrate, which
// ran its own AI planner and wrote four invented steps:
//
//   Scout will source recruiting/staffing companies hiring sales roles,
//   Aria will rank and screen companies against icp, Hawk will enrich top
//   company with website intel, Penn will draft outreach.
//
// `planner_source: "ai"`. Those steps carry no `metadata.tool_input`, so the
// mission was dropped at plan persistence, the task reached run-agent with an
// instruction string, and the paid preflight refused it:
//
//   missing_mission: no LeadMissionV1 on this task; paid execution is refused
//   because nothing states what is being bought
//
// Nothing ran, nothing was charged — and the user was shown a four-agent plan
// for work that could never execute, then a failure.
//
// The seam was between two functions, so no test inside either could see it.
// This one holds the whole path: compile, preview, Start, delegate, and the
// preflight that decides whether a provider may be reached.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { installFakeNetwork, type Row } from "../_helpers/fakeNetwork.ts";
import {
  sendTurn, modelRequest, SUPABASE_URL, WORKSPACE, CONVERSATION,
} from "../_helpers/pilotTurn.ts";
import { missionHash, isLeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  buildPaidExecutionPreflight,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";

const SOURCING =
  "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.";

function seed(): Record<string, Row[]> {
  return {
    conversations: [{ id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1" }],
    messages: [],
    workspace_members: [{ id: "wm", workspace_id: WORKSPACE, user_id: "user-1", role: "owner" }],
    company_brain: [{
      id: "cb", workspace_id: WORKSPACE, status: "active", onboarding_completed: true,
      icp: { segments: ["recruiting agencies"] },
      offer: { summary: "AI workforce" }, buyers: { roles: ["Head of Talent"] },
    }],
    lead_candidates: [], accounts: [], contacts: [], outreach_drafts: [],
    saved_outputs: [], monitoring_subjects: [], signal_events: [],
    request_understanding_log: [], tasks: [], approvals: [],
  };
}

const isBrain = (s: string) => s.includes("REFERENCES");
const brainReply = modelRequest([{
  objective: "source", entity: "company", count: 3,
  requirements: [{
    event: "hiring", subject: "company", phrase: "hiring sales roles",
    qualifier: { role_terms: ["sales roles"] },
  }],
}]);

Deno.test("the approved mission reaches orchestrate unchanged, by hash", async () => {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL,
    tables,
    modelReplies: [
      { when: (_u, s) => isBrain(s), content: brainReply },
      { when: (_u, s) => !isBrain(s), content: "prose" },
    ],
    // Start delegates; the test is what it delegates WITH.
    functionReplies: {
      orchestrate: {
        task_plan_id: "plan-1", plan_summary: "6 capabilities", total_steps: 1,
        agents: ["scout"], plan: { steps: [{ agent_slug: "scout", task_title: "Execute the approved mission" }] },
      },
    },
  });

  try {
    // ── 1. THE PREVIEW ────────────────────────────────────────────────────
    const preview = await sendTurn(SOURCING, tables);
    const card = preview.metadata.workflow_confirmation as Record<string, unknown>;
    assert(card, "the preview must produce a card, or there is no Start to press");
    const previewedMission = card.lead_mission;
    assert(isLeadMissionV1(previewedMission), "the card carries a real mission");
    const previewedHash = await missionHash(previewedMission);

    // NOTHING DELEGATED YET.
    assertEquals(net.functionCalls.length, 0, "a preview must not start work");

    // ── 2. THE START, EXACTLY AS THE CARD DISPATCHES IT ───────────────────
    const modelCallsBeforeStart = net.modelCalls.length;
    const started = await sendTurn(SOURCING, tables, {
      action_source: "lead_intake_card",
      metadata: { confirmed: true, lead_mission: previewedMission },
    });
    assertEquals(started.status, 200);

    // ── 3. AND IT COST NO MODEL CALL ──────────────────────────────────────
    //
    // The user approved a specific compiled mission. Asking a model to re-read
    // the sentence that produced it can only agree (a wasted call), disagree
    // (execute something they did not approve), or fail — which is what
    // happened live at 16:14: sixteen seconds, no understanding, and the
    // fall-through delegated with no mission at all.
    assertEquals(modelCallsBeforeStart, net.modelCalls.length,
      "an approved Start must not consult the understanding model");

    // ── 4. WHAT WAS DELEGATED ─────────────────────────────────────────────
    const call = net.functionCalls.find((c) => c.fn === "orchestrate");
    assert(call, "Start must delegate to orchestrate");
    const sent = (call.body ?? {}) as Record<string, unknown>;
    const sentMission = sent.lead_mission;
    assert(isLeadMissionV1(sentMission),
      "a mission must travel with the delegation — its absence is what the preflight refused");

    // THE ASSERTION THIS FILE EXISTS FOR.
    const sentHash = await missionHash(sentMission);
    assertEquals(sentHash, previewedHash,
      "the mission executed must be the mission approved, byte for byte");
    assertEquals(sentMission.original_user_query, SOURCING,
      "and it must still carry the user's own words");
  } finally {
    net.restore();
  }
});

Deno.test("the approved mission passes the paid preflight it used to fail", async () => {
  // The exact check that refused task bf13ff42, run against what now travels.
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables,
    modelReplies: [
      { when: (_u, s) => isBrain(s), content: brainReply },
      { when: (_u, s) => !isBrain(s), content: "prose" },
    ],
  });
  let mission: unknown;
  try {
    const preview = await sendTurn(SOURCING, tables);
    mission = (preview.metadata.workflow_confirmation as Record<string, unknown>).lead_mission;
  } finally {
    net.restore();
  }
  assert(isLeadMissionV1(mission));

  const plan = buildCapabilityGraph(mission);
  const preflight = buildPaidExecutionPreflight({
    mission, plan, firstProvider: plan.steps[0]?.providers?.[0] ?? null,
    // deno-lint-ignore no-explicit-any
  } as any);

  assertFalse(preflight.blocked.some((b) => b.code === "missing_mission"),
    "the block that stopped the production run must not reproduce");
  assert(plan.steps.length > 0, "and the graph must have work to do");
});

Deno.test("the plan a mission produces is derived, not planned", async () => {
  // ORCHESTRATE MUST NOT CONSULT A PLANNER FOR AN APPROVED MISSION. The AI
  // planner wrote Scout/Aria/Hawk/Penn from the raw sentence and dropped the
  // mission; the Claude lead planner is a second model with the same power.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));

  const i = src.indexOf("const approvedMission = isLeadMissionV1(lead_mission)");
  assert(i > 0, "orchestrate must recognise an approved mission");
  const branch = src.slice(i, i + 2400);
  assert(branch.includes("buildCapabilityGraph(approvedMission)"),
    "the plan must come from the graph Stage 1 previewed and the engine executes");
  assert(branch.includes("lead_mission: approvedMission"),
    "and the mission must be attached to the step, or run-agent cannot find it");
  assert(branch.includes('planner_source: "capability_graph"'),
    "the persisted plan must record that no planner was consulted");

  // The AI planner runs only when nothing has been planned yet.
  const aiGate = src.indexOf("let ai: any = null;");
  assert(aiGate > i, "the mission branch must run before the AI planner");
  assert(src.slice(aiGate, aiGate + 60).includes("if (!parsed)"),
    "and the AI planner must be skipped once a plan exists");

  // The second planner is skipped too.
  assert(src.includes('const qlPlan = plannerSource === "capability_graph" ? null : await planQualifiedLeadBeforePersistence'),
    "the Claude lead planner must not re-decide an approved mission's steps");
});

Deno.test("every compiled mission carries the contract the executor demands", async () => {
  // LIVE, task 364c8594: the mission reached run-agent — `missing_mission` was
  // gone — and was blocked by `incompatible_planner_contract`: "the mission
  // carries no contract version, so it was compiled by a build that predates
  // this guard". It had been compiled seconds earlier by that same build.
  //
  // The stamp lived at ONE call site. `buildMissionForPrompt` spread it on
  // after compiling; the Chat Brain lead route takes `final_mission` directly
  // and inherited nothing. Two producers, one of which remembered.
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables,
    modelReplies: [
      { when: (_u, s) => isBrain(s), content: brainReply },
      { when: (_u, s) => !isBrain(s), content: "prose" },
    ],
  });
  let mission: Record<string, unknown>;
  try {
    const preview = await sendTurn(SOURCING, tables);
    mission = (preview.metadata.workflow_confirmation as Record<string, unknown>)
      .lead_mission as Record<string, unknown>;
  } finally {
    net.restore();
  }

  const { checkContractCompatibility } = await import(
    "../../../supabase/functions/_shared/leadRuntimeIdentity.ts");
  const check = checkContractCompatibility(
    mission.lead_intelligence_contract_version as string | null,
    (mission.planner_runtime as { git_sha?: string } | undefined)?.git_sha ?? null);
  assertEquals(check.ok, true,
    `the executor must accept a mission this build just compiled: ${
      check.ok ? "" : check.detail}`);
});

Deno.test("the runtime stamp does not change the question being asked", async () => {
  // The stamp is not in `missionHash` on purpose: redeploying the planner does
  // not change what the user asked for, and a mission approved before a deploy
  // must still match itself after one. If this ever fails, every card approved
  // across a deploy would execute as a different mission.
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables,
    modelReplies: [
      { when: (_u, s) => isBrain(s), content: brainReply },
      { when: (_u, s) => !isBrain(s), content: "prose" },
    ],
  });
  let mission: Record<string, unknown>;
  try {
    const preview = await sendTurn(SOURCING, tables);
    mission = (preview.metadata.workflow_confirmation as Record<string, unknown>)
      .lead_mission as Record<string, unknown>;
  } finally {
    net.restore();
  }
  assert(isLeadMissionV1(mission));
  const withStamp = await missionHash(mission);
  const stripped = { ...mission } as Record<string, unknown>;
  delete stripped.planner_runtime;
  delete stripped.lead_intelligence_contract_version;
  // deno-lint-ignore no-explicit-any
  const withoutStamp = await missionHash(stripped as any);
  assertEquals(withStamp, withoutStamp,
    "the build that compiled a mission is not part of what it asks for");
});

Deno.test("an approved Start survives the understanding model being down", async () => {
  // LIVE, conversation 8ab3bbfa: Chat Brain could not read the Start message.
  // The unreadable path exempted card actions from its honest refusal — on the
  // reasoning that a card "is executed deterministically below" — but the only
  // path that executes a mission IS the Chat Brain lead route, so the exemption
  // sent it to the generic tail, which delegated with no mission. The user was
  // shown "the orchestrator failed: mission_not_compiled" for a mission that
  // was valid, stamped, and sitting in the request metadata.
  const tables = seed();

  // The preview needs a working model; the Start must not need one at all.
  let allowBrain = true;
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables,
    modelReplies: [
      {
        when: (_u, s) => {
          if (isBrain(s) && !allowBrain) {
            throw new Error("understanding model is down");
          }
          return isBrain(s);
        },
        content: brainReply,
      },
      { when: (_u, s) => !isBrain(s), content: "prose" },
    ],
    functionReplies: {
      orchestrate: {
        task_plan_id: "plan-1", plan_summary: "6 capabilities", total_steps: 1,
        agents: ["scout"], plan: { steps: [] },
      },
    },
  });

  try {
    const preview = await sendTurn(SOURCING, tables);
    const mission = (preview.metadata.workflow_confirmation as Record<string, unknown>)
      .lead_mission;
    assert(isLeadMissionV1(mission));

    // FROM HERE THE MODEL IS UNAVAILABLE.
    allowBrain = false;
    const started = await sendTurn(SOURCING, tables, {
      action_source: "lead_intake_card",
      metadata: { confirmed: true, lead_mission: mission },
    });
    assertEquals(started.status, 200);

    const call = net.functionCalls.find((c) => c.fn === "orchestrate");
    assert(call, "the approved mission must execute without the model");
    const sent = (call.body as Record<string, unknown>).lead_mission;
    assert(isLeadMissionV1(sent));
    assertEquals(await missionHash(sent), await missionHash(mission));
  } finally {
    net.restore();
  }
});

Deno.test("a confirmed card with no valid mission is refused, never delegated", async () => {
  // The other half of removing the exemption. A card action whose mission does
  // not validate has nothing deterministic waiting for it, and delegating
  // without one is what produced `mission_not_compiled` in the chat.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = src.indexOf("HAS_DETERMINISTIC_HANDLER");
  assert(i > 0, "the exemption must name the handlers that actually exist");
  const block = src.slice(i, i + 400);
  assert(block.includes("lead_source_card") && block.includes("lead_source_brief"),
    "only a submitted lead brief has a deterministic path below");
  assertFalse(/!isPreConfirmed/.test(block),
    "a confirmed card must no longer be blanket-exempt from the honest refusal");

  // And the approved Start runs BEFORE understanding is attempted.
  const start = src.indexOf("const approvedOnStart = actionMetadata?.lead_mission");
  const brain = src.indexOf("await understandRequest(message, {");
  assert(start > 0 && start < brain,
    "an approved Start must execute before the model is consulted");
});
