// ONE APPROVED CARD, ONE PLAN.
//
// ── THE RUN THIS REPRODUCES ────────────────────────────────────────────────
//
// Conversation 38e904cb, 2026-09-27. One "Check 1 company: Fuse AI" card, one
// Start — and pilot-chat received that card's Start twice, 8.4 s apart
// (14:08:58.94 and 14:09:07.37, identical metadata). Each became a plan
// (a3953169, 0123c1a3, idempotency_key NULL on both), a queue row and a paid
// mission: LinkedIn company details bought twice, a second Firecrawl map.
//
// These tests hold the whole Start path — the card's id in the Start,
// pilot-chat's verification of it, the key on the plan, orchestrate's answer
// to a repeat and to a race — through the real handlers, with only `fetch`
// replaced.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { installFakeNetwork, type Row } from "../_helpers/fakeNetwork.ts";
import {
  sendTurn, modelRequest, SUPABASE_URL, WORKSPACE, CONVERSATION,
} from "../_helpers/pilotTurn.ts";
import {
  DUPLICATE_START_REPLY, isStartIdempotencyKey, startIdempotencyKey, verifiedStartKey,
} from "../../../supabase/functions/_shared/startIdempotency.ts";

// BUDGET IS NOT WHAT THIS FILE TESTS. Spend enforcement fails closed since
// 2026-09-28 (budgetFailClosed.test.ts); these drive real handlers against
// fakes with no credit ledger and no model-spend meter, and relied on the old
// `observe` default without saying so. Now they say so.
Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "observe");
Deno.env.set("MODEL_SPEND_ENFORCEMENT", "observe");

Deno.env.set("ORCHESTRATE_IMPORT_ONLY", "1");
const { handleOrchestrate } = await import("../../../supabase/functions/orchestrate/index.ts");

const OTHER_WORKSPACE = "33333333-3333-4333-8333-333333333333";
const OTHER_CONVERSATION = "44444444-4444-4444-8444-444444444444";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = `start:${CARD}`;

const SOURCING =
  "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.";
const isBrain = (s: string) => s.includes("REFERENCES");
const brainReply = modelRequest([{
  objective: "source", entity: "company", count: 3,
  requirements: [{
    event: "hiring", subject: "company", phrase: "hiring sales roles",
    qualifier: { role_terms: ["sales roles"] },
  }],
}]);
const MODEL = [
  { when: (_u: string, s: string) => isBrain(s), content: brainReply },
  { when: (_u: string, s: string) => !isBrain(s), content: "prose" },
];

function seed(): Record<string, Row[]> {
  return {
    conversations: [
      { id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1" },
      { id: OTHER_CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1" },
    ],
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
    task_plans: [], activity_feed: [],
  };
}

/** Preview a request and return the card message and the mission it carries. */
async function preview(tables: Record<string, Row[]>) {
  const turn = await sendTurn(SOURCING, tables);
  const card = turn.metadata.workflow_confirmation as Record<string, unknown>;
  assert(card, "the preview must produce a card");
  return { cardId: String(turn.reply!.id), mission: card.lead_mission };
}

const start = (mission: unknown, extra: Record<string, unknown> = {}) => ({
  action_source: "lead_intake_card",
  metadata: { confirmed: true, lead_mission: mission, ...extra },
});

async function orchestrate(body: Record<string, unknown>) {
  const res = await handleOrchestrate(new Request(`${SUPABASE_URL}/functions/v1/orchestrate`, {
    method: "POST",
    headers: { Authorization: "Bearer test-jwt", "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: WORKSPACE, conversation_id: CONVERSATION, ...body }),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

/** Let `invokeInBackground` land its kickoff before the calls are counted. */
const settle = () => new Promise((r) => setTimeout(r, 50));

/** A mission orchestrate will accept, taken from a real preview. */
async function missionFor(tables: Record<string, Row[]>): Promise<unknown> {
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL });
  try {
    return (await preview(tables)).mission;
  } finally {
    net.restore();
  }
}

// ── THE KEY ────────────────────────────────────────────────────────────────

Deno.test("key: a message id becomes a Start key; anything else does not", () => {
  assertEquals(startIdempotencyKey(CARD), KEY);
  assertEquals(startIdempotencyKey(CARD.toUpperCase()), KEY, "one card, one key, whatever the case");
  for (const bad of [null, undefined, "", "plan-1", 42, `${CARD} `.repeat(2), "start:" + CARD]) {
    assertEquals(startIdempotencyKey(bad), null, String(bad));
  }
  assert(isStartIdempotencyKey(KEY));
  for (const bad of [CARD, "start:", "start:nope", `start:${CARD.toUpperCase()}`, `continue:${CARD}`, null]) {
    assertFalse(isStartIdempotencyKey(bad), String(bad));
  }
});

Deno.test("key: a claimed card id is honoured only for a workflow card in this conversation", () => {
  const card = { id: CARD, conversation_id: CONVERSATION, role: "assistant", metadata: { type: "workflow_confirmation" } };
  assertEquals(verifiedStartKey(CARD, CONVERSATION, card), KEY);
  assertEquals(verifiedStartKey(CARD, CONVERSATION, null), null, "no such message");
  assertEquals(verifiedStartKey(CARD, OTHER_CONVERSATION, card), null, "another conversation's card");
  assertEquals(verifiedStartKey(CARD, CONVERSATION, { ...card, role: "user" }), null, "not a card");
  assertEquals(verifiedStartKey(CARD, CONVERSATION, { ...card, metadata: { type: "execution_plan" } }), null);
  assertEquals(verifiedStartKey(CARD, CONVERSATION, { ...card, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), null,
    "the row must be the message the card named");
  assertEquals(verifiedStartKey(undefined, CONVERSATION, card), null, "an older client names no card");
});

// ── ORCHESTRATE ────────────────────────────────────────────────────────────

Deno.test("orchestrate: the first Start stores its key on the plan and starts one run", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  try {
    const r = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    assertEquals(r.status, 200);
    assertFalse(r.body.deduplicated === true);
    assertEquals(tables.task_plans.map((p) => p.idempotency_key), [KEY]);
    assertEquals(net.functionCalls.length, 1, "one kickoff");
  } finally {
    net.restore();
  }
});

Deno.test("orchestrate: the same Start again returns the SAME plan and starts nothing", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  tables.task_plans.push({ id: "plan-first", workspace_id: WORKSPACE, idempotency_key: KEY, plan_summary: "6 capabilities" });
  tables.tasks.push({ id: "task-first", plan_id: "plan-first", created_at: "2026-09-27T14:09:03Z" });
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  try {
    const r = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    assertEquals(r.status, 200);
    assertEquals(r.body.deduplicated, true);
    assertEquals([r.body.plan_id, r.body.task_plan_id, r.body.task_id], ["plan-first", "plan-first", "task-first"]);
    assertEquals(tables.task_plans.length, 1, "no second plan");
    assertEquals(net.functionCalls, [], "no second kickoff — nothing enqueued, nothing bought");
    assertFalse(net.requests.some((q) => q.startsWith("GET company_brain")),
      "answered before any planning work");
  } finally {
    net.restore();
  }
});

Deno.test("orchestrate: a key is scoped to its workspace", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  tables.task_plans.push({ id: "elsewhere", workspace_id: OTHER_WORKSPACE, idempotency_key: KEY });
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  try {
    const r = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    assertFalse(r.body.deduplicated === true, "another workspace's plan is not this Start");
    assertEquals(tables.task_plans.filter((p) => p.workspace_id === WORKSPACE).length, 1);
  } finally {
    net.restore();
  }
});

Deno.test("orchestrate: two Starts that race past the check collapse on the unique index", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  // THE RACE, AS POSTGRES WOULD SEE IT: the other request's plan is committed
  // after this one's lookup and before its insert, so the lookup misses and the
  // insert hits `task_plans_idempotency_uniq`.
  const inner = globalThis.fetch;
  let lookups = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (href.includes("/rest/v1/task_plans") && method === "GET" && href.includes("idempotency_key")) {
      lookups += 1;
      if (lookups === 1) {
        tables.task_plans.push({ id: "plan-raced", workspace_id: WORKSPACE, idempotency_key: KEY, plan_summary: "raced" });
        tables.tasks.push({ id: "task-raced", plan_id: "plan-raced", created_at: "2026-09-27T14:09:03Z" });
        return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    if (href.includes("/rest/v1/task_plans") && method === "POST") {
      const row = JSON.parse(String(init?.body ?? "{}"));
      if (row.idempotency_key && tables.task_plans.some((p) =>
        p.workspace_id === row.workspace_id && p.idempotency_key === row.idempotency_key)) {
        return new Response(JSON.stringify({
          code: "23505", details: null, hint: null,
          message: 'duplicate key value violates unique constraint "task_plans_idempotency_uniq"',
        }), { status: 409, headers: { "content-type": "application/json" } });
      }
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    const r = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals([r.body.deduplicated, r.body.plan_id, r.body.task_id], [true, "plan-raced", "task-raced"]);
    assertEquals(tables.task_plans.length, 1);
    assertEquals(net.functionCalls, [], "the loser of the race enqueues nothing");
  } finally {
    globalThis.fetch = inner;
    net.restore();
  }
});

Deno.test("orchestrate: no key, or a malformed one, runs exactly as before", async () => {
  for (const idempotency_key of [undefined, "start:not-a-uuid", CARD, 7]) {
    const tables = seed();
    const mission = await missionFor(tables);
    const net = installFakeNetwork({
      supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
      functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
    });
    try {
      const r = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key });
      await settle();
      assertEquals(r.status, 200, String(idempotency_key));
      assertEquals(tables.task_plans.length, 1);
      assertEquals(tables.task_plans[0].idempotency_key, undefined, "a malformed key is never stored");
      assertFalse(net.requests.some((q) => q.includes("idempotency_key")), "and never looked up");
      assertEquals(net.functionCalls.length, 1);
    } finally {
      net.restore();
    }
  }
});

// ── PILOT-CHAT ─────────────────────────────────────────────────────────────

Deno.test("pilot-chat: a Start naming its card sends that card's key to orchestrate", async () => {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { orchestrate: { task_plan_id: "plan-1", plan_summary: "6 capabilities", total_steps: 1, agents: ["scout"] } },
  });
  try {
    const { cardId, mission } = await preview(tables);
    const turn = await sendTurn(SOURCING, tables, start(mission, { confirmation_message_id: cardId }));
    assertEquals(turn.status, 200);
    const call = net.functionCalls.find((c) => c.fn === "orchestrate");
    assertEquals((call?.body as Record<string, unknown>).idempotency_key, `start:${cardId}`);
    assertEquals(turn.metadata.type, "execution_plan", "a first Start is announced as usual");
  } finally {
    net.restore();
  }
});

Deno.test("pilot-chat: a repeated Start is answered as already running, not as a new plan", async () => {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: {
      orchestrate: { success: true, deduplicated: true, idempotency_key: "k", plan_id: "plan-first", task_plan_id: "plan-first", task_id: "task-first" },
    },
  });
  try {
    const { cardId, mission } = await preview(tables);
    const turn = await sendTurn(SOURCING, tables, start(mission, { confirmation_message_id: cardId }));
    assertEquals(turn.status, 200);
    assertEquals(turn.content, DUPLICATE_START_REPLY);
    assertEquals(turn.metadata.type, "duplicate_start");
    assertEquals(turn.metadata.plan_id, "plan-first");
    assertFalse(tables.messages.some((m) => (m.metadata as Record<string, unknown>)?.type === "execution_plan"),
      "no second 'I created a plan' for a run that does not exist");
  } finally {
    net.restore();
  }
});

Deno.test("pilot-chat: an id that is not this conversation's card sends no key", async () => {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { orchestrate: { task_plan_id: "plan-1", plan_summary: "s", total_steps: 1, agents: ["scout"] } },
  });
  try {
    const { cardId, mission } = await preview(tables);
    const userMsg = tables.messages.find((m) => m.role === "user")!.id as string;
    tables.messages.push({
      id: CARD, conversation_id: OTHER_CONVERSATION, role: "assistant",
      metadata: { type: "workflow_confirmation" }, content: "elsewhere",
    });
    const sent: unknown[] = [];
    for (const claimed of [undefined, "garbage", userMsg, CARD]) {
      await sendTurn(SOURCING, tables, start(mission, claimed === undefined ? {} : { confirmation_message_id: claimed }));
      sent.push((net.functionCalls.at(-1)?.body as Record<string, unknown>).idempotency_key);
    }
    assertEquals(sent, [undefined, undefined, undefined, undefined],
      "no id (an older client), a non-id, a user message, another conversation's card");
    assert(cardId, "the real card exists — the refusals are not for lack of one");
  } finally {
    net.restore();
  }
});

// ── THE INCIDENT, END TO END ───────────────────────────────────────────────

Deno.test("38e904cb: the same card's Start arriving twice runs ONE mission", async () => {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  // pilot-chat's delegation goes to the REAL orchestrate handler.
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (href === `${SUPABASE_URL}/functions/v1/orchestrate`) {
      return await handleOrchestrate(new Request(href, init));
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    const { cardId, mission } = await preview(tables);
    const action = start(mission, { confirmation_message_id: cardId });

    const first = await sendTurn(SOURCING, tables, action);
    const second = await sendTurn(SOURCING, tables, action);
    await settle();

    assertEquals(first.metadata.type, "execution_plan");
    assertEquals(second.metadata.type, "duplicate_start");
    assertEquals(tables.task_plans.length, 1, "one plan");
    assertEquals(tables.task_plans[0].idempotency_key, `start:${cardId}`);
    assertEquals(second.metadata.plan_id, tables.task_plans[0].id, "the repeat points at the plan that exists");
    assertEquals(net.functionCalls.filter((c) => c.fn === "run-agent" || c.fn === "enqueue-lead-mission").length, 1,
      "one kickoff — one paid mission");
  } finally {
    globalThis.fetch = inner;
    net.restore();
  }
});

// ── LAUNCH HARDENING: THE REST OF THE DUPLICATE-START MATRIX ───────────────

/** A network that enforces `task_plans_idempotency_uniq` exactly as Postgres does. */
function withUniqueIndex(tables: Record<string, Row[]>): () => void {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (href.includes("/rest/v1/task_plans") && method === "POST") {
      const row = JSON.parse(String(init?.body ?? "{}"));
      if (row.idempotency_key && tables.task_plans.some((p) =>
        p.workspace_id === row.workspace_id && p.idempotency_key === row.idempotency_key)) {
        return new Response(JSON.stringify({
          code: "23505", details: null, hint: null,
          message: 'duplicate key value violates unique constraint "task_plans_idempotency_uniq"',
        }), { status: 409, headers: { "content-type": "application/json" } });
      }
    }
    return inner(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = inner; };
}

Deno.test("two DIFFERENT approved cards are two legitimate missions: two plans, two kickoffs", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  const restore = withUniqueIndex(tables);
  try {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const a = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    const b = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: `start:${other}` });
    await settle();
    assertEquals([a.status, b.status], [200, 200]);
    assertFalse(a.body.deduplicated === true || b.body.deduplicated === true);
    assertEquals(tables.task_plans.map((p) => p.idempotency_key).sort(), [KEY, `start:${other}`].sort());
    assertEquals(net.functionCalls.length, 2);
  } finally {
    restore();
    net.restore();
  }
});

Deno.test("the real flow: a Start whose response was lost, retried, returns the plan the first one created", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  const restore = withUniqueIndex(tables);
  try {
    const first = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    // The browser never saw `first` (timeout) and sends the identical request again.
    const retry = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
    await settle();
    assertEquals(retry.body.deduplicated, true);
    assertEquals(retry.body.plan_id, first.body.plan_id ?? first.body.task_plan_id);
    assertEquals(tables.task_plans.length, 1);
    assertEquals(net.functionCalls.length, 1, "one mission, one kickoff, one spend");
  } finally {
    restore();
    net.restore();
  }
});

Deno.test("three concurrent Starts of one card (two tabs and a retry) become ONE plan and ONE kickoff", async () => {
  const tables = seed();
  const mission = await missionFor(tables);
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
    functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
  });
  const restore = withUniqueIndex(tables);
  try {
    const rs = await Promise.all([1, 2, 3].map(() =>
      orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY })));
    await settle();
    assert(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
    assertEquals(tables.task_plans.length, 1, "one plan");
    assertEquals(new Set(rs.map((r) => r.body.plan_id ?? r.body.task_plan_id)).size, 1, "every caller is told the same plan");
    assertEquals(rs.filter((r) => r.body.deduplicated !== true).length, 1, "exactly one caller created it");
    assertEquals(net.functionCalls.length, 1, "one kickoff");
  } finally {
    restore();
    net.restore();
  }
});

// ── THE CREDIT START GATE, END TO END (launch hardening, 2026-09-28) ──────
//
// Spend fails closed and credits are a beta grant. The real handler, with
// enforcement on: a workspace nobody granted is refused before anything
// exists; one credit lets the same Start through.

Deno.test("orchestrate: enforced credits — no grant is refused at the door with the beta message; one credit starts", async () => {
  Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "enforce");
  try {
    const tables = seed();
    const mission = await missionFor(tables);
    // The table exists; this workspace was simply never granted anything.
    tables.workspace_credit_balances = [];
    const net = installFakeNetwork({
      supabaseUrl: SUPABASE_URL, tables, modelReplies: MODEL,
      functionReplies: { "run-agent": { ok: true }, "enqueue-lead-mission": { ok: true } },
    });
    try {
      const refused = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
      await settle();
      assertEquals(refused.status, 402);
      assertEquals([refused.body.error, refused.body.reason], ["credits_required", "no_credits"]);
      assert(String(refused.body.details).includes("private beta"));
      assertEquals(tables.task_plans, [], "no plan row");
      assertEquals(tables.tasks, [], "no task row");
      assertEquals(net.functionCalls, [], "nothing enqueued, nothing bought");

      tables.workspace_credit_balances = [{ workspace_id: WORKSPACE, balance_credits: 1 }];
      const started = await orchestrate({ user_instruction: SOURCING, lead_mission: mission, idempotency_key: KEY });
      await settle();
      assertEquals(started.status, 200, JSON.stringify(started.body).slice(0, 300));
      assertEquals(tables.task_plans.length, 1);
      assertEquals(net.functionCalls.length, 1, "one kickoff");
    } finally {
      net.restore();
    }
  } finally {
    Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "observe");
  }
});
