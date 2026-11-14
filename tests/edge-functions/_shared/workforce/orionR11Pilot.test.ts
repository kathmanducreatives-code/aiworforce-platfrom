// R1.1 · THE pilot-chat WIRING — read from the deployed source, so a later edit
// that lets the draft branch reach orchestrate, a content row, a send or a
// provider fails here. No network.
import { assert, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { converseSystemPrompt } from "../../../../supabase/functions/_shared/converseSurface.ts";
import { orionDraftSystemPrompt, ORION_DRAFT_NOTICE, withDraftNotice } from "../../../../supabase/functions/_shared/orionDraft.ts";
import { orionAnswerShapeFor, ORION_BUSINESS_ANSWER_SHAPE } from "../../../../supabase/functions/_shared/orionEvidenceContext.ts";
import { OUTREACH_WITHOUT_LEADS } from "../../../../supabase/functions/_shared/composeSurface.ts";
import { renderReadAnswer, type ReadPlan } from "../../../../supabase/functions/_shared/readSurface.ts";
import { subQuestions } from "../../../../supabase/functions/_shared/orionIntelligence.ts";

const PILOT = await Deno.readTextFile(new URL("../../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
const draftStart = PILOT.indexOf("if (orion?.draft) {");
const draftEnd = PILOT.indexOf("\n      }\n", PILOT.indexOf("chat_brain: { route: \"orion_draft\", answered", draftStart));
const DRAFT_BRANCH = PILOT.slice(draftStart, draftEnd);

Deno.test("the draft branch exists, and sits before the blocked-ambiguity reply and the compose route", () => {
  assert(draftStart > 0 && draftEnd > draftStart);
  assert(draftStart < PILOT.indexOf('if (brainBinding.kind === "reply")'), "a 'which company?' block must not pre-empt a draft");
  assert(draftStart < PILOT.indexOf('if (brainRoute.kind === "compose" && brainRoute.compose)'));
});

Deno.test("the draft branch is TEXT ONLY: no delegation, no content row, no fetch, no send, no approval", () => {
  for (const forbidden of ["delegateToOrchestrate", "createCanonicalContentItem", "fetch(", "showWorkflowConfirmation",
    "approvals", "outreach_drafts", ".insert(", ".update(", "send", "publish(", "apify", "firecrawl"]) {
    assertFalse(DRAFT_BRANCH.toLowerCase().includes(forbidden.toLowerCase()), `draft branch must not contain ${forbidden}`);
  }
  // Exactly one model call, through the shared provider (OpenAI, spend-ceilinged), and one reply.
  assertStringIncludes(DRAFT_BRANCH, "await generateText({");
  assertStringIncludes(DRAFT_BRANCH, "budget: fail.modelCalls");
  assertStringIncludes(DRAFT_BRANCH, "return await replyAndReturn(");
  assertStringIncludes(DRAFT_BRANCH, "text_only: true, delegated: false, persisted: false, sent: false, published: false");
});

Deno.test("drafting is ORION's only while delegation is off; the release flag is read, not hard-coded", () => {
  assertStringIncludes(PILOT, "orionRoute(requestForRouting, message, { evidenceEnabled: evidenceOn, delegationEnabled: delegationEnabled() })");
  assertStringIncludes(PILOT, 'return String(read("AGENTORY_DELEGATION_ENABLED") ?? "").trim().toLowerCase() !== "false";');
});

Deno.test("defence in depth: with delegation off the compose route creates no row and no card", () => {
  const at = PILOT.indexOf('if (brainRoute.kind === "compose" && brainRoute.compose) {');
  const guard = PILOT.indexOf("if (!delegationEnabled()) {", at);
  assert(guard > at && guard < PILOT.indexOf("createCanonicalContentItem(", at) && guard < PILOT.indexOf("showWorkflowConfirmation(", at));
});

Deno.test("the reply carries a server-side 'draft only' notice, whatever the model wrote", () => {
  const t = withDraftNotice("Here is your post.");
  assertStringIncludes(t, ORION_DRAFT_NOTICE);
  assertStringIncludes(ORION_DRAFT_NOTICE, "Nothing was sent, scheduled, published or saved");
  assertStringIncludes(ORION_DRAFT_NOTICE, "isn't enabled in this release");
});

Deno.test("the draft prompt forbids invented claims, prior relationships and invented names", () => {
  const p = orionDraftSystemPrompt({ workspaceContext: "profile", facts: [], kinds: ["linkedin_message"] });
  for (const s of ["Never invent customers", "prior relationship", "[First name]", "never imply you have met or spoken before",
    "Do not say it was sent", "2–2"]) assertStringIncludes(p, s);
});

Deno.test("converse prompt: with delegation off ORION offers drafts and says execution is not enabled", () => {
  const p = converseSystemPrompt({ workspaceContext: "profile", facts: [], delegationEnabled: false });
  assertStringIncludes(p, "text drafts written right here in the chat");
  assertStringIncludes(p, "Starting agent work is NOT enabled in this release");
  // Unchanged when the flag is not passed.
  assertFalse(converseSystemPrompt({ workspaceContext: "profile", facts: [] }).includes("NOT enabled in this release"));
});

Deno.test("answer shape: every sub-question is listed for a compound ask (test 4)", () => {
  const q = subQuestions("Tell me how many leads, qualified leads, monitored companies, and stored signals exist in my current workspace. Then identify the strongest opportunities. Answer every part separately and distinguish missing data from zero results.");
  const shape = orionAnswerShapeFor(q);
  assertStringIncludes(shape, `THIS QUESTION HAS ${q.length} PARTS`);
  for (const w of ["How many leads?", "How many qualified leads?", "How many monitored companies?", "How many stored signals?", "strongest opportunities"]) assertStringIncludes(shape, w);
  for (const w of ["could not be read", "Never count the [E#] items", "Accounts and lead candidates are different things"]) assertStringIncludes(ORION_BUSINESS_ANSWER_SHAPE, w);
});

Deno.test("read template: a failed query says so, and is never rendered as 'you don't have any'", () => {
  for (const target of ["signals", "companies"] as const) {
    const t = renderReadAnswer({ target, since_days: null, limit: 10, subject: null, subjects: [] } as unknown as ReadPlan,
      { target, counts: {}, items: [], empty: false, failed: true, gaps: [] });
    assertStringIncludes(t, "retrieval error on my side, not an empty list");
    assertFalse(/don't have any/.test(t));
  }
});

Deno.test("read template: a signal with no event date shows its observed date (test 11)", () => {
  const t = renderReadAnswer({ target: "signals", since_days: null, limit: 10, subject: null, subjects: [] } as unknown as ReadPlan, {
    target: "signals", counts: { total: 37, shown: 1, sales_hiring: 1 }, empty: false, gaps: [],
    items: [{ signal_type: "sales_hiring", subject_key: "x.example", occurred_at: null, observed_at: "2026-10-13T09:00:00Z",
      source_url: "https://x.example/jobs", lifecycle_status: "active", normalized_value: { lisa: { company: { name: "X" } } } }],
  });
  assertStringIncludes(t, "observed 2026-10-13");
  assertFalse(t.includes("date not stated"));
});

Deno.test("test 16's misleading copy is gone: an empty conversation is not an empty workspace", () => {
  assertFalse(/don't have any leads saved/i.test(OUTREACH_WITHOUT_LEADS));
});
