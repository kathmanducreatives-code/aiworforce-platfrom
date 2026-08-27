// WRITING A POST AND WRITING TO SOMEONE ARE DIFFERENT WORK.
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────
//
// `compose` was absent from the router's `SERVABLE` set, so every request to
// write anything returned "Content generation isn't wired up yet."
//
// It was wired up. Penn drafts approval-gated outreach against remembered
// leads; Scribe writes posts and reports. Both sit BELOW the Chat Brain block,
// and the refusal returned before either could be reached — so making Chat
// Brain authoritative silently disabled two features that had worked for
// months. The third defect of this shape, after the URL research refusal and
// the invalid sourcing category: understanding the request correctly is what
// stopped it being served.
//
// ── AND THE SAFETY RULE THE SPLIT CARRIES ──────────────────────────────────
//
// Outreach is approval-gated and must never be sent without a person's say-so.
// A blog post is not. So the split is made on WHO the writing is aimed at, not
// on the verb used — `draftOutreachRe` (/\b(draft|write|send)\s+(outreach|
// emails?|messages?)\b/) made "write something for my prospects" content and
// "send messages" with nobody to send to outreach.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planCompose, OUTREACH_WITHOUT_LEADS,
} from "../../../supabase/functions/_shared/composeSurface.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestEntity, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";

const compose = (
  entity: RequestEntity, references: RequestReference[] = [], count: number | null = null,
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "write it", objective: "compose",
  parts: [{
    id: "p1", objective: "compose",
    subject: { entity, references },
    output: { shape: "artifact", count },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

// ══ 1. THE AUDIENCE DECIDES, NOT THE VERB ══════════════════════════════════

Deno.test("1. writing aimed at people is outreach", () => {
  assertEquals(planCompose(compose("person"))!.kind, "outreach");
  // Or at leads we already hold, whatever the entity.
  assertEquals(
    planCompose(compose("content", [{ kind: "saved_set", value: "my leads" }]))!.kind,
    "outreach");
  assertEquals(
    planCompose(compose("content", [{ kind: "prior_result", value: "the top 5" }]))!.kind,
    "outreach");
});

Deno.test("2. writing with no recipient is content", () => {
  assertEquals(planCompose(compose("content"))!.kind, "content");
  assertEquals(planCompose(compose("content"))!.targets_existing, false);
  // A NAMED subject is a topic to write about, not somebody to write to.
  assertEquals(
    planCompose(compose("content", [{ kind: "named", value: "our launch" }]))!.kind,
    "content");
});

Deno.test("3. a non-compose request plans nothing", () => {
  const r = compose("content");
  r.parts[0].objective = "read";
  assertEquals(planCompose(r), null);
});

// ══ 2. THE SURFACE IS REACHED ══════════════════════════════════════════════

Deno.test("4. compose routes to compose — never to a clarification", () => {
  const route = routeRequest(compose("content"), { spendAllowed: true });
  assertEquals(route.kind, "compose");
  assertFalse(route.kind === "clarify",
    "the objective has surfaces; refusing it disabled two working features");
  assertEquals(bindRoute(route).kind, "compose");
});

Deno.test("5. compose never becomes a sourcing run", () => {
  // A request to WRITE is not a request to FIND. Projecting it would read the
  // description of what to write as a description of companies to source.
  const route = routeRequest(
    compose("person", [{ kind: "saved_set", value: "my leads" }], 5),
    { spendAllowed: true });
  assertEquals(route.lead, undefined);
  assertEquals(route.compose!.count, 5);
});

// ══ 3. THE APPROVAL GATE IS UNCHANGED ══════════════════════════════════════

Deno.test("6. outreach requires confirmation; content does not", () => {
  const out = routeRequest(compose("person"), { spendAllowed: true });
  assertEquals(out.requires_confirmation, true);
  const post = routeRequest(compose("content"), { spendAllowed: true });
  assertEquals(post.requires_confirmation, false);
});

Deno.test("7. writing is never a provider purchase from this router", () => {
  // Drafting is a model call the existing path owns; sending is gated
  // downstream. Neither is spend this router authorises, whatever the caller
  // allows.
  for (const entity of ["person", "content"] as RequestEntity[]) {
    assertEquals(routeRequest(compose(entity), { spendAllowed: true }).may_spend, false);
  }
});

Deno.test("8. outreach with nobody to write to asks who, and says nothing is sent", () => {
  assert(/don't have any leads saved/i.test(OUTREACH_WITHOUT_LEADS));
  assert(/without your approval/i.test(OUTREACH_WITHOUT_LEADS),
    "the safety promise belongs in the refusal too");
});

// ══ 4. THE WIRING ══════════════════════════════════════════════════════════

Deno.test("9. pilot-chat serves both halves, and gates only the one with a recipient", async () => {
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const brainAt = pilot.indexOf("if (chatBrainEnabled(readEnvSafe))");
  const baselineAt = pilot.indexOf("── PHASE 0 BASELINE", brainAt);
  const block = pilot.slice(brainAt, baselineAt);

  assert(block.includes('brainRoute.kind === "compose"'));
  assert(block.includes('intent: "draft_outreach"'), "Penn's contract, unchanged");
  assert(block.includes('intent: "content_creation"'), "Scribe's contract, unchanged");
  assert(block.includes("showWorkflowConfirmation("),
    "outreach must still pass through the confirmation gate");
  assert(block.includes("OUTREACH_WITHOUT_LEADS"),
    "and refuse honestly when there is nobody to write to");
});

Deno.test("10. the confirmation card records the request, not a classifier verdict", async () => {
  // `baseMeta` is built entirely from `decision` — the classifier's category,
  // confidence and chosen actor. Carrying it onto a card for a route Chat Brain
  // decided would record the wrong provenance for the run being confirmed.
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = pilot.indexOf('missionOrigin: "chat_brain_compose_outreach"');
  assert(i > 0, "the outreach route must be wired");
  const before = pilot.slice(Math.max(0, i - 2200), i);
  assert(before.includes('classifier_source: "chat_brain"'),
    "the card must say which layer decided");
  assertFalse(/admin,\s*baseMeta,\s*"outreach"/.test(before),
    "and must not borrow the classifier's metadata");
});

Deno.test("11. conversation memory is readable before the request is routed", async () => {
  // It used to load below the whole classifier chain, so a request to write to
  // "the top 5" could be understood but not served — the leads it referred to
  // were not readable at the point of routing.
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const load = pilot.indexOf("await loadConversationMemory({");
  const brainAt = pilot.indexOf("if (chatBrainEnabled(readEnvSafe))");
  assert(load > 0 && brainAt > 0);
  assert(load < brainAt, "memory must be loaded before understanding routes the request");
  assertEquals([...pilot.matchAll(/await loadConversationMemory\(\{/g)].length, 1,
    "and loaded exactly once");
});
