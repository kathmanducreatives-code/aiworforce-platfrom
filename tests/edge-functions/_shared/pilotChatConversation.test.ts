// THE PRODUCTION CONVERSATION, REPLAYED THROUGH THE REAL HANDLER.
//
// ── WHAT THIS REPRODUCES ───────────────────────────────────────────────────
//
// Conversation 2beba9cc, run manually against production on 2026-08-28 at
// 09:57. Five turns, three of them wrong:
//
//   "What leads do I currently have?"      32 named, ranking gap declared.  ok
//   "yes show the full list"               byte-identical reply, still 5.   P1
//   "Which of those look strongest?"       'I'm not sure which company
//                                           "those leads" refers to.'       P0
//   "Tell me more about the second one."   a PAID research preview, for a
//                                           company already in the leads.   P0
//   "Find 3 recruiting or staffing…"       compiled, previewed, no spend.   ok
//
// 6,119 tests passed while that happened. Every one of the three defects was a
// property of `handlePilotChat` — of the ORDER things run in and what reaches
// which surface — and the source-shape tests that existed could only assert
// the shapes they had been told to look for.
//
// So this file runs the function. Only `fetch` is replaced; understanding,
// referent resolution, routing, the read plan, the query shaping, the
// renderer, the outcome and the persisted metadata all execute for real.

import {
  assert, assertEquals, assertFalse, assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  installFakeNetwork, type ModelReply, type Row,
} from "../_helpers/fakeNetwork.ts";
import {
  sendTurn, modelRequest, SUPABASE_URL, WORKSPACE, CONVERSATION,
} from "../_helpers/pilotTurn.ts";

// ── THE WORKSPACE, AS PRODUCTION HOLDS IT ─────────────────────────────────
//
// Five named leads with real identifiers and `fit_score: null` on every row —
// the exact condition that makes ranking unsupported and must be declared
// rather than answered with an arbitrary order.
const LEADS: Array<[string, string, string]> = [
  ["NOSO LABS(YC S25)", "noso.so", "linkedin.com/company/noso-labs"],
  ["Andy AI (W24)", "with-andy.com", "linkedin.com/company/with-andy"],
  ["AgentCollect (YC S23)", "agentcollect.com", "linkedin.com/company/agentcollect"],
  ["PointOne", "pointone.com", "linkedin.com/company/pointoneai"],
  ["Arini", "arini.ai", "linkedin.com/company/ariniai"],
  // MORE THAN ONE PAGE, deliberately. With five rows a default page and a
  // request for everything return the same list, and "show me the full list"
  // would pass while doing nothing — which is exactly what shipped.
  ...Array.from({ length: 9 }, (_, i): [string, string, string] => [
    `Filler ${i + 1}`, `filler${i + 1}.com`, `linkedin.com/company/filler${i + 1}`,
  ]),
];

function seed(): Record<string, Row[]> {
  return {
    conversations: [{
      id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1",
      title: "New chat", created_at: "2026-08-28T09:57:00Z",
    }],
    messages: [],
    workspace_members: [{
      id: "wm-1", workspace_id: WORKSPACE, user_id: "user-1", role: "owner",
    }],
    company_brain: [{
      id: "cb-1", workspace_id: WORKSPACE, status: "active",
      // The gate that stands in front of every objective that spends.
      onboarding_completed: true,
      icp: { segments: ["recruiting agencies"] },
      offer: { summary: "AI workforce for lean GTM teams" },
      buyers: { roles: ["Head of Talent"] },
    }],
    lead_candidates: [
      ...LEADS.map(([name, domain, li], i) => ({
        id: `lead-${i + 1}`, workspace_id: WORKSPACE, status: "new",
        fit_score: null, priority: null, reason: null,
        created_at: `2026-08-${String(28 - i).padStart(2, "0")}T00:00:00Z`,
        accounts: { name, domain, linkedin_url: li },
      })),
      // ── THE LEAD WITH NO COMPANY RECORD ────────────────────────────────
      //
      // Production holds 32 leads and 31 accounts. That one row is why "show
      // the full list" answered "showing the 31 most recent of 32 — say 'show
      // the full list' for the rest": it is counted and cannot be named, so
      // the offer repeated after the user had already taken it up.
      {
        id: "lead-orphan", workspace_id: WORKSPACE, status: "new",
        fit_score: null, priority: null, reason: null,
        created_at: "2026-08-01T00:00:00Z", accounts: null,
      },
    ],
    accounts: [],
    contacts: [],
    outreach_drafts: [],
    saved_outputs: [],
    monitoring_subjects: [],
    signal_events: [],
    request_understanding_log: [],
    tasks: [],
    approvals: [],
  };
}

const isBrain = (system: string) => system.includes("REFERENCES");

/**
 * The utterance this call is about — the MESSAGE block, not the transcript.
 *
 * Matching the whole prompt matched the wrong turn from turn two onwards: the
 * history now contains every earlier utterance, so "What leads do I currently
 * have?" appeared in the prompt for every later message. That the fix was
 * needed at all is the test noticing that history is really being sent.
 */
const utteranceOf = (user: string) => {
  const at = user.lastIndexOf("MESSAGE:");
  return at < 0 ? user : user.slice(at + "MESSAGE:".length);
};

/** Chat Brain answers per utterance; every other model call is the surface. */
function replies(map: Array<[string, unknown]>, prose: string): ModelReply[] {
  return [
    ...map.map(([utterance, content]): ModelReply => ({
      when: (user, system) => isBrain(system) && utteranceOf(user).includes(utterance),
      content,
    })),
    { when: (_u, system) => !isBrain(system), content: prose },
  ];
}

async function conversation(
  turns: Array<{ say: string; brain: unknown }>, prose = "A grounded answer.",
) {
  const tables = seed();
  const net = installFakeNetwork({
    supabaseUrl: SUPABASE_URL,
    tables,
    modelReplies: replies(turns.map((t) => [t.say, t.brain]), prose),
  });
  try {
    const out = [];
    for (const t of turns) out.push(await sendTurn(t.say, tables));
    return { out, tables, net };
  } finally {
    net.restore();
  }
}

// ══ TURN 1 — THE READ ══════════════════════════════════════════════════════

Deno.test("turn 1: the workspace's real leads, named, with the ranking gap", async () => {
  const { out, tables } = await conversation([{
    say: "What leads do I currently have?",
    brain: modelRequest([{ objective: "read", entity: "company" }]),
  }]);
  const [t1] = out;

  assertStringIncludes(t1.content, "15 leads saved");
  assertStringIncludes(t1.content, "NOSO LABS(YC S25)");
  assertStringIncludes(t1.content, "Arini");
  // THE GAP IS DECLARED, NOT INFERRED FROM THE WORDING. This question does not
  // sound like a ranking request and is told about the absence anyway.
  assertStringIncludes(t1.content, "can't be ranked reliably");

  // CAPABILITY HONESTY: the surface returns its own verdict.
  const outcome = t1.metadata.outcome as Record<string, unknown>;
  assertEquals(outcome.state, "PARTIALLY_SATISFIED");

  // AND THE SET IS POINTABLE. Without this every follow-up clarifies forever.
  const ref = t1.metadata.presented_referents as Record<string, unknown>;
  const entities = ref.entities as Array<Record<string, unknown>>;
  assertEquals(entities.length, 5, "the default page lists a sample of five");
  assertEquals(entities[1].name, "Andy AI (W24)");
  assertEquals(entities[1].position, 2);
  assertEquals(entities[1].entity_key, "domain:with-andy.com");

  assertEquals(tables.messages.filter((m) => m.role === "assistant").length, 1);
});

// ══ TURN 2 — CONVERSATION HISTORY ACTUALLY REACHES CHAT BRAIN ══════════════

Deno.test("turn 2: the prior turns are in the understanding prompt", async () => {
  // LIVE: `ChatBrainContext.conversation` was declared, documented, rendered
  // into the prompt — and never passed. Every message arrived as the first in
  // its conversation, which made a back-reference unrepresentable.
  const { net } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "Which of those look strongest?",
      brain: modelRequest([{
        objective: "read", entity: "company",
        references: [{ kind: "prior_result", value: "those", cardinality: "all" }],
      }]),
    },
  ]);

  const second = net.modelCalls.filter((c) => c.system.includes("REFERENCES"))[1];
  assertStringIncludes(second.user, "RECENT CONVERSATION:");
  assertStringIncludes(second.user, "What leads do I currently have?");
  assertStringIncludes(second.user, "NOSO LABS(YC S25)");
  // AND NOT ITS OWN UTTERANCE TWICE.
  const historyBlock = second.user.slice(
    second.user.indexOf("RECENT CONVERSATION:"), second.user.indexOf("MESSAGE:"));
  assertFalse(historyBlock.includes("Which of those look strongest?"),
    "the row inserted for this turn must not be shown back as its own history");
});

// ══ TURN 3 — THE PLURAL REFERENCE ══════════════════════════════════════════

Deno.test("turn 3: 'those' binds the whole displayed set", async () => {
  // LIVE: `referent:ambiguous_referent`, candidates 5 — "I'm not sure which
  // company \"those leads\" refers to. Which one?" The user had not asked
  // about one company.
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "Which of those look strongest?",
      brain: modelRequest([{
        objective: "read", entity: "company",
        references: [{ kind: "prior_result", value: "those", cardinality: "all" }],
      }]),
    },
  ]);
  const t3 = out[1];

  assertFalse(/I'm not sure which company/.test(t3.content),
    "a plural reference must not be answered with a disambiguation prompt");

  const brain = t3.metadata.chat_brain as Record<string, unknown>;
  assertEquals(brain.route, "read");
  assertEquals((brain.scoped_set as string[]).length, 5,
    "all five displayed companies must be bound");

  // THE ANSWER IS ABOUT THOSE FIVE, and it says so.
  assertStringIncludes(t3.content, "Those 5");
  assertStringIncludes(t3.content, "Andy AI (W24)");

  // RANKING IS UNSUPPORTED AND SAYS SO, rather than returning an order.
  assertStringIncludes(t3.content, "can't be ranked reliably");
  const outcome = t3.metadata.outcome as Record<string, unknown>;
  assertEquals(outcome.state, "PARTIALLY_SATISFIED");
  const gaps = outcome.gaps as Array<Record<string, unknown>>;
  assert(gaps.some((g) => g.code === "leads_unscored"));
});

// ══ TURN 4 — THE ORDINAL, AND WHAT IT MUST NOT COST ════════════════════════

Deno.test("turn 4: 'the second one' reads held records and buys nothing", async () => {
  // LIVE: the ordinal resolved perfectly — `bound_referents: 1`,
  // `known_companies: ["Andy AI (W24)"]` — and the reply was a paid research
  // preview for a company already sitting in the workspace's own leads.
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "Tell me more about the second one.",
      // ── THE SHAPE PRODUCTION ACTUALLY RETURNED ────────────────────────
      //
      // `shape: "answer"`, because "tell me more about X" asks for prose. The
      // first version of this test hard-coded `records` — the helper's default
      // — and passed while production failed, because `leadParts` requires
      // `records` and the whole held-records answer lived inside the lead
      // route. The turn died at
      // `lead_projection_refused:objective_not_servable` with "I understood
      // the request, but I can't turn it into a run yet."
      brain: modelRequest([{
        objective: "research", entity: "company", shape: "answer",
        references: [{ kind: "prior_result", value: "the second one", cardinality: "one" }],
      }], 0.99),
    },
  ]);
  const t4 = out[1];

  // NOT A PREVIEW, AND NOT A CHARGE. Naming the cost of the research the user
  // could ask for next is the honest part; presenting a Start card for work
  // they did not request is the failure.
  assertEquals(t4.metadata.type, undefined,
    "no workflow_confirmation card for a question answerable from records");
  assertEquals(t4.metadata.mission_preview, undefined);
  assertEquals(t4.metadata.lead_mission, undefined);
  assertFalse(/Here's what I'd run/.test(t4.content),
    "a mission narration means the paid path was taken");

  const brain = t4.metadata.chat_brain as Record<string, unknown>;
  assertEquals(brain.served_from, "held_records");
  assertEquals(brain.spent, false);
  // THE EXACT ENTITY SURVIVED THE TURN — position 2, not position 1.
  assertEquals(brain.scoped_to, "domain:with-andy.com");
  assertStringIncludes(t4.content, "Andy AI (W24)");

  // WHAT IS KNOWN AND WHAT IS MISSING, both stated.
  const outcome = t4.metadata.outcome as Record<string, unknown>;
  assertEquals(outcome.state, "PARTIALLY_SATISFIED");
  const gaps = outcome.gaps as Array<Record<string, unknown>>;
  assert(gaps.some((g) => g.code === "no_fresh_research"),
    "the absence of a live check must be declared, not implied");
});

// ══ TURN 5 — THE PRONOUN KEEPS THE BINDING ════════════════════════════════

Deno.test("turn 5: 'them' after a drill-down still means that company", async () => {
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "Tell me more about the second one.",
      brain: modelRequest([{
        objective: "research", entity: "company", shape: "answer",
        references: [{ kind: "prior_result", value: "the second one", cardinality: "one" }],
      }], 0.99),
    },
    {
      say: "What do we already know about them?",
      // ── AND THE CARDINALITY PRODUCTION ACTUALLY RETURNED ──────────────
      //
      // `one`, at confidence 0.78 — the model read a plural pronoun as
      // selecting a single company. The test asserted `all`, which is the
      // judgement we would like it to make rather than the one it makes.
      //
      // This must work anyway, and it does WITHOUT trusting the label: the
      // previous turn narrowed the presented set to the single company it was
      // about, so there is exactly one candidate and nothing to be ambiguous
      // between. Live, that turn had persisted nothing, so "them" resolved
      // against the thirty-one from two turns back and clarified.
      brain: modelRequest([{
        objective: "read", entity: "signal", shape: "answer",
        references: [{ kind: "prior_result", value: "them", cardinality: "one" }],
      }], 0.78),
    },
  ]);
  const t5 = out[2];

  // THE BINDING NARROWED AND STAYED NARROW. After a turn about one company,
  // "them" must not widen back to the five-company list two turns earlier.
  const brain = t5.metadata.chat_brain as Record<string, unknown>;
  assertEquals((brain.scoped_set as string[]), ["domain:with-andy.com"]);
  assertFalse(/I'm not sure which company/.test(t5.content));
  assertStringIncludes(t5.content, "Andy AI (W24)");
});

// ══ TURN 6 — SOURCING STILL COMPILES, AND STILL WAITS ═════════════════════

Deno.test("turn 6: sourcing compiles a mission and stops at the Start", async () => {
  const { out, tables } = await conversation([{
    say: "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
    brain: modelRequest([{
      objective: "source", entity: "company", count: 3,
      requirements: [{
        event: "hiring", subject: "company", phrase: "hiring sales roles",
        qualifier: { role_terms: ["sales roles"] },
      }],
    }]),
  }]);
  const [t6] = out;

  const mission = t6.metadata.lead_mission as Record<string, unknown>;
  assertEquals(mission.version, "lead-mission-v1");
  assertEquals(mission.requested_count, 3);
  assertEquals((mission.required_signals as unknown[]).length, 1);

  assertEquals(t6.metadata.type, "workflow_confirmation");
  const outcome = t6.metadata.outcome as Record<string, unknown>;
  assertEquals(outcome.state, "REQUIRES_UNLOCK");
  assertEquals(outcome.reason, "awaiting_start");

  // ── THE PREVIEW DESCRIBES THE GRAPH THAT WOULD RUN ──────────────────────
  //
  // Not a second model's idea of the plan. `generateWorkflowConfirmation`
  // makes its own call and compiles its own mission, and a narration from
  // there can describe work the executor was never going to perform.
  const preview = t6.metadata.mission_preview as Record<string, unknown>;
  assertEquals(preview.feasible, true);
  assert((preview.steps as unknown[]).length > 0,
    "the narration must come from real capability steps");
  // AND IT NAMES NO AGENT. Promising "Scout will…" is a claim about who does
  // the work, which the graph does not make and the user cannot check.
  for (const persona of ["Scout", "Mira", "Penn", "Scribe", "Ivy"]) {
    assertFalse(t6.content.includes(persona),
      `the preview must not promise ${persona} specifically`);
  }

  // NOTHING RAN. A delegation would have thrown in the fake network.
  assertEquals(tables.tasks.length, 0);
  assertEquals(tables.approvals.length, 0);
});

// ══ TURN 7 — ORDINARY CONVERSATION, GROUNDED ══════════════════════════════

Deno.test("turn 7: 'hello' answers as Pilot without inventing workspace state", async () => {
  const { out, net } = await conversation(
    [
      {
        say: "What leads do I currently have?",
        brain: modelRequest([{ objective: "read", entity: "company" }]),
      },
      {
        say: "hello",
        brain: modelRequest([{
          objective: "converse", entity: "conversation", shape: "answer",
        }], 1),
      },
    ],
    "Hey — I'm Pilot. What would you like to work on?",
  );
  const t7 = out[1];

  assertEquals(t7.reply?.agent_slug, "pilot",
    "Pilot is the default speaker; a specialist needs a recorded handoff");
  assertStringIncludes(t7.content, "Pilot");

  // THE FACTS IT WAS GIVEN CARRY THEIR SCOPE. Live, a conversation count of
  // zero under a `workspace_facts` heading became "we're starting from zero"
  // one turn after 32 leads were named.
  const converseCall = net.modelCalls.find((c) => c.system.includes("You are Pilot"))!;
  assertStringIncludes(converseCall.system, "TRUE OF THIS CONVERSATION ONLY");
  assertStringIncludes(converseCall.system,
    "a number you were not given is a number you do not know");
  // AND IT SEES THE CONVERSATION IT IS IN.
  assertStringIncludes(converseCall.user, "What leads do I currently have?");
});

// ══ THE FULL LIST ═════════════════════════════════════════════════════════

Deno.test("a lead with no company record is declared, not silently dropped", async () => {
  // LIVE: 32 leads, 31 accounts. The answer listed 31, called it "31 most
  // recent of 32", and offered the full list again — an offer that repeats
  // after being taken up is the same broken affordance in a new place.
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "yes show the full list",
      brain: modelRequest([{
        objective: "read", entity: "company", completeness: "all",
      }], 1),
    },
  ]);
  const full = out[1];

  assertFalse(/say "show the full list" for the rest/.test(full.content),
    "the offer must not repeat once it has been taken up");
  assertStringIncludes(full.content, "no company record yet");
  const gaps = (full.metadata.outcome as Record<string, unknown>)
    .gaps as Array<Record<string, unknown>>;
  assert(gaps.some((g) => g.code === "leads_without_company"),
    "the difference between the count and the list must be declared");
});

Deno.test("a plural reference over the full list lists all of it", async () => {
  // LIVE, 11:41:39: `bound_referents: 31` — every company bound — and the
  // answer was "Those 5 (26 of the 31 you pointed at aren't in your saved
  // leads)". All 26 were sitting in the table it had just read. The display
  // sample narrowed the list and the shortfall was then computed from the
  // SLICE, turning a rendering limit into a false claim about the user's data.
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "yes show the full list",
      brain: modelRequest([{
        objective: "read", entity: "company", completeness: "all",
      }], 1),
    },
    {
      say: "Which of those look strongest?",
      brain: modelRequest([{
        objective: "read", entity: "company",
        references: [{ kind: "prior_result", value: "those", cardinality: "all" }],
      }]),
    },
  ]);
  const scoped = out[2];

  assertFalse(/aren't in your saved leads/.test(scoped.content),
    "every bound company came from the leads table and must not be reported missing");
  assertStringIncludes(scoped.content, "Those 14");
  // ALL OF THEM, not a sample of five.
  for (const [name] of LEADS) assertStringIncludes(scoped.content, name);
  // AND RANKING IS STILL REFUSED.
  assertStringIncludes(scoped.content, "can't be ranked reliably");
});

Deno.test("'show the full list' is honoured, not repeated back", async () => {
  // LIVE: the read offered "ask for more if you need the full list", the user
  // said "yes show the full list", and the reply was byte-identical.
  const { out } = await conversation([
    {
      say: "What leads do I currently have?",
      brain: modelRequest([{ objective: "read", entity: "company" }]),
    },
    {
      say: "yes show the full list",
      brain: modelRequest([{
        objective: "read", entity: "company", completeness: "all",
      }]),
    },
  ]);
  assert(out[0].content !== out[1].content,
    "an explicit request for everything must not return the previous answer");
  // AND THE ANSWER NO LONGER PROMISES WHAT IT CANNOT DO.
  assertFalse(/ask for more if you need the full list/.test(out[1].content));
});
