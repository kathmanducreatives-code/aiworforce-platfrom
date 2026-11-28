// ORION-001…004 · Brain TEST manual acceptance (2026-11-28), with the owner's exact prompts.
//
//   001  "…three most important things we should focus on this week, and why?" was answered
//        with the historical activity brief ("no recent activity, no action needed").
//   002  after approving "never target crypto", "What industries should we avoid, and what is
//        our typical sales cycle?" hit "I don't have a way to look that up yet".
//   003  "Our sales cycle has changed from 45 days to 60 days. Please remember this." produced
//        no memory proposal (and "Remember that…" statements without never/always none either).
//   004  a question about testimonials / case studies / ROI sometimes hit the same dead end,
//        and proof was called "good" with none recorded.
//
// Shared causes: the understanding prompt filed priorities and Company-Brain questions as
// `read`; the read surface answered reads it has no source for with a canned sentence, and
// advice with the activity brief; the brief promotion ran on advice; explicit "remember"
// was not an offer; proof points reached ORION unlabelled. Layers tested here: the routing
// step (several plausible model readings, both flag states), the memory offer, and the REAL
// pilot-chat handler in a NEW conversation (only the network is faked).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { isAdviceQuestion, orionRoute, subQuestions } from "../../../../supabase/functions/_shared/orionIntelligence.ts";
import { detectMemoryOffer } from "../../../../supabase/functions/_shared/orionMemoryOffer.ts";
import { offerMemoryFromTurn } from "../../../../supabase/functions/_shared/orionMemoryOfferRuntime.ts";
import { buildCompanyBrainContext } from "../../../../supabase/functions/_shared/companyBrainContext.ts";
import { installFakeNetwork, type ModelReply, type Row } from "../../_helpers/fakeNetwork.ts";
import { CONVERSATION, modelRequest, sendTurn, SUPABASE_URL, WORKSPACE } from "../../_helpers/pilotTurn.ts";

Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "observe");
Deno.env.set("MODEL_SPEND_ENFORCEMENT", "observe");

const FOCUS = "Based on our Company Brain, what are the three most important things we should focus on this week, and why?";
const AVOID = "What industries should we avoid, and what is our typical sales cycle?";
const PROOF_1 = "Do we have any verified testimonials or ROI statistics?";
const PROOF_2 = "What testimonials, case studies and ROI numbers can we use in outreach?";
const REMEMBER_CRYPTO = "Remember that we should never target crypto companies.";
const REMEMBER_45 = "Remember that our sales cycle is about 45 days.";
const CHANGE_60 = "Our sales cycle has changed from 45 days to 60 days. Please remember this.";

type Part = Record<string, unknown>;
const part = (objective: string, entity: string, shape = "answer", refs: unknown[] = []): Part => ({
  id: "p1", objective, subject: { entity, references: refs, filters: [] }, requirements: [],
  output: { shape, count: null, completeness: "sample", medium: "text" }, depends_on: [],
});
async function understand(utterance: string, parts: Part[]) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity: [], confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const u = await understandRequest(utterance, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  if (!u.ok) throw new Error(`not understood: ${utterance}`);
  return u.request;
}
async function routeOf(utterance: string, parts: Part[], evidenceEnabled: boolean) {
  const r = orionRoute(await understand(utterance, parts), utterance, { evidenceEnabled, delegationEnabled: false });
  const route = routeRequest(r.request, { spendAllowed: true });
  const binding = bindRoute(route);
  return binding.kind === "read" ? "read" : route.kind;
}

// ── 1. ROUTING: every plausible reading, both flag states, reaches ORION's grounded answer ──
const READINGS: Array<[string, string, Part[][]]> = [
  ["ORION-001", FOCUS, [[part("read", "conversation")], [part("converse", "conversation")], [part("read", "content")]]],
  ["ORION-002", AVOID, [[part("read", "content")], [part("read", "market")], [part("read", "conversation")], [part("converse", "conversation")]]],
  ["ORION-004 (first)", PROOF_1, [[part("read", "content")], [part("read", "content", "records")], [part("converse", "conversation")]]],
  ["ORION-004 (later)", PROOF_2, [[part("read", "content")], [part("read", "competitor")], [part("read", "conversation")]]],
];
for (const [bug, prompt, readings] of READINGS) {
  for (const evidenceEnabled of [true, false]) {
    Deno.test(`${bug}: "${prompt.slice(0, 48)}…" is ORION's grounded answer (evidence context ${evidenceEnabled ? "on" : "off"})`, async () => {
      // Without the evidence context (no deployed environment runs that way any more) a
      // `conversation` read with no advice in it is still the activity brief by design; the
      // understanding prompt now files such questions as converse.
      for (const parts of readings.filter((p) => evidenceEnabled || isAdviceQuestion(prompt) || (p[0].subject as Part).entity !== "conversation")) {
        const label = await routeOf(prompt, parts, evidenceEnabled);
        assertEquals(label, "converse", `reading ${JSON.stringify(parts.map((p) => [p.objective, (p.subject as Part).entity, (p.output as Part).shape]))}`);
      }
    });
  }
}

Deno.test("ORION-001: advice is not the activity brief; a status question still is", async () => {
  assert(isAdviceQuestion(FOCUS), "focus … and why → advice (never promoted to the brief)");
  assertFalse(isAdviceQuestion("Brief me on this week"));
  // A real status ask keeps its route: the brief without the evidence context (with it, ORION's
  // evidence answer already serves "brief me", unchanged since R1.2).
  assertEquals(await routeOf("Brief me on this week", [part("read", "conversation")], false), "read");
});

Deno.test("ORION-002: a compound question is two questions", () => {
  assertEquals(subQuestions(AVOID), ["What industries should we avoid.", "what is our typical sales cycle?"]);
});

Deno.test("simple listings are unchanged: they keep the read template in both flag states", async () => {
  for (const evidenceEnabled of [true, false]) {
    assertEquals(await routeOf("List my leads", [part("read", "company", "records")], evidenceEnabled), "read");
    assertEquals(await routeOf("Show my signals", [part("read", "signal", "events")], evidenceEnabled), "read");
  }
});

// ── 2. MEMORY OFFERS: creation, correction, and never stored without approval ──────────────
Deno.test("ORION-002: “Remember that we should never target crypto companies.” offers an industry exclusion", () => {
  const o = detectMemoryOffer(REMEMBER_CRYPTO);
  assert(o && o.kind === "lasting" && o.what === "exclusion");
  assertEquals(o.item.value, { type: "industry", value: "Crypto" });
});

Deno.test("ORION-003: creating (45 days) and correcting (60 days) land on ONE memory key; the correction says what it replaces", () => {
  const create = detectMemoryOffer(REMEMBER_45);
  const correct = detectMemoryOffer(CHANGE_60);
  assert(create && create.kind === "lasting" && create.what === "fact", "explicit “remember” is an offer");
  assert(correct && correct.kind === "lasting" && correct.what === "fact", "a correction is an offer");
  assertEquals(create.item.fact_key, "fact.sales-cycle");
  assertEquals(correct.item.fact_key, create.item.fact_key, "same subject → same key → the writer replaces, history keeps 45");
  assertEquals(create.item.value, "Sales cycle: about 45 days");
  assertEquals(correct.item.value, "Sales cycle: 60 days");
  assertStringIncludes(String(correct.item.reason), "45 days");
  // Questions are never offers.
  assertEquals(detectMemoryOffer(AVOID), null);
});

Deno.test("ORION-003: an offer is a PENDING proposal (approval required), never a memory write", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = { rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve({ data: { outcome: "contradiction", proposal_id: "prop-60", contradicts_memory_id: "mem-45" }, error: null });
  } };
  const r = await offerMemoryFromTurn(admin, { workspaceId: WORKSPACE, conversationId: CONVERSATION, messageId: "m1", message: CHANGE_60, profile: null });
  assertEquals(calls.map((c) => c.fn), ["company_brain_proposal_submit"], "only the proposal queue — never company_brain_memory_write");
  assertEquals(r?.status, "pending");
  assertEquals(r?.replaces_memory_id, "mem-45");
});

// ── 3. EVIDENCE IS NEVER INVENTED ───────────────────────────────────────────────────────────
Deno.test("ORION-004: with no proof recorded ORION is told so; listed proof is labelled as the company's own claim", () => {
  const none = buildCompanyBrainContext({ schema_version: 2, company: { name: "Northwind" }, positioning: { promise: "Fewer missed visits" } } as never);
  assertStringIncludes(none, "Proof points: none recorded (no testimonials, case studies or ROI figures on file)");
  const some = buildCompanyBrainContext({ schema_version: 2, company: { name: "Northwind" }, positioning: { proof_points: ["Used by 3 pilot teams"] } } as never);
  assertStringIncludes(some, "Proof points (the company's own claims, not independently verified): Used by 3 pilot teams");
});

// ── 4. THE REAL HANDLER, A NEW CONVERSATION: recall of approved memory, strategy from the Brain ──
const NORTHWIND = {
  schema_version: 2,
  company: { name: "Northwind Field Services (fictional)", description: "Scheduling software for field-service teams" },
  target_customer: { industries: ["Manufacturing", "Distribution"], geography: ["United States"], company_size: { min: 10, max: 200, label: "10-200" } },
  goals: { gtm: "10 qualified meetings a month", outreach: "50 replies a month", content: "", competitor_tracking: "", hiring: "" },
  positioning: { promise: "Fewer missed visits", differentiators: ["Built for small dispatch teams"], proof_points: [] },
};
const approvedByReview = { created_by_kind: "agent", created_by_agent: "orion", approval_status: "approved", approved_by: "user-1", proposal_id: "p-1" };
const memoryRow = (id: string, over: Row): Row => ({
  id, workspace_id: WORKSPACE, scope: "workspace", scope_ref: null, version: 1, source_type: "agent_suggestion",
  source_ref: null, source_url: null, verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
  persistence: "persistent", observed_at: "2026-11-27T10:00:00Z", review_at: null, expires_at: null,
  updated_at: "2026-11-27T10:00:00Z", redacted_at: null, reason: null, ...approvedByReview, ...over,
});
function seed(): Record<string, Row[]> {
  return {
    conversations: [{ id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1", title: "New chat", created_at: "2026-11-28T09:00:00Z" }],
    messages: [],
    workspace_members: [{ id: "wm-1", workspace_id: WORKSPACE, user_id: "user-1", role: "owner" }],
    company_brain: [{ id: "cb-1", workspace_id: WORKSPACE, onboarding_completed: true, updated_at: "2026-11-27T09:00:00Z", profile: NORTHWIND }],
    company_brain_memory: [
      memoryRow("mem-crypto", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:crypto", value_type: "object", value: { type: "industry", value: "Crypto" } }),
      memoryRow("mem-cycle", { kind: "fact", category: "company_facts", fact_key: "fact.sales-cycle", value_type: "text", value: "Sales cycle: 60 days", version: 2 }),
    ],
    company_brain_memory_proposals: [],
    lead_candidates: [], accounts: [], contacts: [], outreach_drafts: [], saved_outputs: [], monitoring_subjects: [],
    signal_events: [], request_understanding_log: [], tasks: [], approvals: [],
  };
}
const isBrain = (system: string) => system.includes("REFERENCES");
async function freshTurn(say: string, reading: unknown, evidence: boolean) {
  if (evidence) Deno.env.set("AGENTORY_ORION_EVIDENCE_CONTEXT", "true"); else Deno.env.delete("AGENTORY_ORION_EVIDENCE_CONTEXT");
  const tables = seed();
  const replies: ModelReply[] = [
    { when: (_u, system) => isBrain(system), content: reading },
    { when: (_u, system) => !isBrain(system), content: "A grounded answer." },
  ];
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: replies });
  try {
    const out = await sendTurn(say, tables);
    const answerCall = net.modelCalls.find((c) => !isBrain(c.system));
    return { out, answerCall };
  } finally {
    net.restore();
    Deno.env.delete("AGENTORY_ORION_EVIDENCE_CONTEXT");
  }
}
const DEAD_END = "I don't have a way to look that up yet";

for (const evidence of [true, false]) {
  Deno.test(`ORION-002 (new conversation, evidence ${evidence ? "on" : "off"}): the approved exclusion and the sales cycle reach ORION; no dead end`, async () => {
    // The reading that dead-ended on Brain TEST: a read of an entity with no read surface.
    const { out, answerCall } = await freshTurn(AVOID, modelRequest([{ objective: "read", entity: "content", shape: "answer" }]), evidence);
    assertEquals(out.status, 200);
    assertFalse(out.content.includes(DEAD_END), out.content);
    assert(answerCall, "ORION's answer was generated from a prompt");
    assertStringIncludes(answerCall!.system, "Crypto", "the approved exclusion is in ORION's context");
    assertStringIncludes(answerCall!.system, "Sales cycle: 60 days", "the approved sales-cycle memory is in ORION's context");
  });

  Deno.test(`ORION-001 (new conversation, evidence ${evidence ? "on" : "off"}): three priorities come from the Brain, not the activity brief`, async () => {
    const { out, answerCall } = await freshTurn(FOCUS, modelRequest([{ objective: "read", entity: "conversation", shape: "answer" }]), evidence);
    assertEquals(out.status, 200);
    assertFalse(out.body.intent === "daily_brief", "not the activity brief");
    assert(answerCall, "ORION answered from a prompt");
    assertStringIncludes(answerCall!.system, "STRATEGY AND PRIORITIES");
    assertStringIncludes(answerCall!.system, "10 qualified meetings a month", "the saved goals ground the advice");
    assertStringIncludes(answerCall!.system, "Proof points: none recorded");
  });

  Deno.test(`ORION-004 (new conversation, evidence ${evidence ? "on" : "off"}): the later proof question is answered, never "good" proof by default`, async () => {
    const { out, answerCall } = await freshTurn(PROOF_2, modelRequest([{ objective: "read", entity: "content", shape: "answer" }]), evidence);
    assertFalse(out.content.includes(DEAD_END), out.content);
    assertStringIncludes(answerCall!.system, "Never call proof good or strong when none is verified");
  });
}
