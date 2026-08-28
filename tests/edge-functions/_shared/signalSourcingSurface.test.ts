// THREE KINDS OF WORK THAT SHARED ONE NAME.
//
// `signal_sourcing` carried eight of `WorkflowDecision`'s fields —
// `signal_type`, `keywords`, `competitors`, `competitor_discovery`,
// `discovery_mode`, `business_website`, `business_description`,
// `extract_commenters` — roughly a third of everything the classifier held. A
// category needing eight flags to say which of itself it means is not one
// category.
//
// It is three, and they differ in what is being sourced: the people who
// commented on a post, the workspace's own rivals, or public activity matching
// topics. The entity says which — the flags existed because the classifier had
// no entity to carry the distinction, so it encoded the answer as a spray of
// fields and let four `if` branches re-derive it.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planSignalSourcing,
} from "../../../supabase/functions/_shared/signalSourcingSurface.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import {
  REQUEST_V1_VERSION, REQUEST_ENTITIES,
  type RequestV1, type RequestEntity, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";
import { SUBJECT_TYPES } from "../../../supabase/functions/_shared/signalSubject.ts";

const src = (
  entity: RequestEntity, references: RequestReference[] = [],
  shape: "records" | "events" | "artifact" = "records",
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u", objective: "source",
  parts: [{
    id: "p1", objective: "source",
    subject: { entity, references },
    output: { shape, count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

const POST = "https://www.linkedin.com/posts/someone_activity-123";
const PROFILE = "https://www.linkedin.com/in/someone";

// ══ 1. THE ENTITY CARRIES THE DISTINCTION ══════════════════════════════════

Deno.test("1. a post link asks who engaged with it", () => {
  const p = planSignalSourcing(src("person", [{ kind: "named", value: POST }]))!;
  assertEquals(p.kind, "post_commenters");
  assertEquals(p.post_urls, [POST]);
});

Deno.test("2. competitor is its own entity, taken from signal_events' vocabulary", () => {
  assert(REQUEST_ENTITIES.includes("competitor"));
  assert(SUBJECT_TYPES.includes("competitor"),
    "the third word borrowed from the schema that already distinguished these");
  assertEquals(planSignalSourcing(src("competitor"))!.kind, "competitor_discovery");
});

Deno.test("3. signal activity is engagement", () => {
  assertEquals(planSignalSourcing(src("signal"))!.kind, "engagement");
  assertEquals(planSignalSourcing(src("content"))!.kind, "engagement");
});

Deno.test("4. a profile link is a target to read, not a post to mine", () => {
  const p = planSignalSourcing(src("signal", [{ kind: "named", value: PROFILE }]))!;
  assertEquals(p.kind, "engagement");
  assertEquals(p.target_urls, [PROFILE]);
  assertEquals(p.post_urls, [], "a profile has no commenters to extract");
});

// ══ 2. WHAT IT MUST NOT CLAIM ══════════════════════════════════════════════

Deno.test("5. sourcing COMPANIES is still a lead mission", () => {
  // The lead pipeline keeps everything it had. This surface takes only the
  // entities it names.
  assertEquals(planSignalSourcing(src("company")), null);
  assertEquals(routeRequest(src("company"), { spendAllowed: true }).kind, "lead_mission");
  assertEquals(planSignalSourcing(src("job")), null);
});

Deno.test("6. person alone is still a lead mission — only a POST link changes that", () => {
  // `person` IS a lead entity, which is why route order matters: pulling
  // commenters off a post would otherwise compile into a mission to go and find
  // people matching a description, buying a discovery run to read one post.
  assertEquals(planSignalSourcing(src("person")), null);
  assertEquals(routeRequest(src("person"), { spendAllowed: true }).kind, "lead_mission");

  const withPost = routeRequest(src("person", [{ kind: "named", value: POST }]),
    { spendAllowed: true });
  assertEquals(withPost.kind, "signal_sourcing");
  assertEquals(withPost.lead, undefined, "and no mission is compiled for it");
});

Deno.test("7. a source part asking for an ARTIFACT is not sourcing", () => {
  // Sourcing yields a list. Asking `source` to produce an artifact is
  // compose-shaped and incoherent; claiming it would turn a malformed request
  // into a paid search instead of a clarification.
  assertEquals(planSignalSourcing(src("content", [], "artifact")), null);
  assertEquals(routeRequest(src("content", [], "artifact"), { spendAllowed: true }).kind,
    "clarify");
});

Deno.test("8. a conversational referent is never a URL to fetch", () => {
  const p = planSignalSourcing(src("signal", [{ kind: "prior_result", value: POST }]));
  assertEquals(p!.post_urls, []);
  assertEquals(p!.target_urls, []);
});

// ══ 3. "AND DRAFT SOMETHING" IS A SECOND ASK, NOT A FLAG ═══════════════════

Deno.test("9. wants_drafts is read from a dependent compose part", () => {
  // The replacement for `needs_dm_drafts` / `needs_comment_drafts`. "Find X and
  // draft outreach" is one request with two steps, which is what was said.
  const r = src("signal");
  assertEquals(planSignalSourcing(r)!.wants_drafts, false);

  r.parts.push({
    id: "p2", objective: "compose",
    subject: { entity: "person", references: [] },
    output: { shape: "artifact", count: null },
    depends_on: ["p1"],
  });
  assertEquals(planSignalSourcing(r)!.wants_drafts, true);

  // An INDEPENDENT compose part is a separate ask, not a follow-on.
  r.parts[1].depends_on = [];
  assertEquals(planSignalSourcing(r)!.wants_drafts, false);
});

Deno.test("10. nothing here grants permission to send", () => {
  const r = src("signal");
  r.parts.push({
    id: "p2", objective: "compose",
    subject: { entity: "person", references: [] },
    output: { shape: "artifact", count: null },
    depends_on: ["p1"],
  });
  // `wants_drafts` reaches the draft path, which is approval-gated wherever it
  // is served. The route itself still cannot raise authority.
  assertEquals(routeRequest(r, { spendAllowed: false }).may_spend, false);
});

// ══ 4. THE WIRING KEEPS EVERY ACTOR CONTRACT ═══════════════════════════════

Deno.test("11. each kind keeps the actor it always had", async () => {
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const brainAt = pilot.indexOf("if (chatBrainEnabled(readEnvSafe))");
  const baselineAt = pilot.indexOf("── PHASE 0 BASELINE", brainAt);
  const block = pilot.slice(brainAt, baselineAt);

  assert(block.includes('"apify_linkedin_post_comments"'), "commenters");
  assert(block.includes('"apify_linkedin_profile_posts"'), "profile posts");
  assert(block.includes('"apify_linkedin_posts"'), "topic and competitor posts");
  assert(block.includes('intent: "extract_commenters"'));
  assert(block.includes('intent: "competitor_discovery"'));
  assert(block.includes('intent: "signal_sourcing"'));
  assertEquals(bindRoute(routeRequest(src("competitor"), { spendAllowed: true })).kind,
    "signal_sourcing");
});

Deno.test("12. competitor discovery still starts from the workspace's own profile", async () => {
  // That is what makes a competitor different from a company: the question is
  // relational, so answering begins with the workspace, not a population filter.
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const i = pilot.indexOf('missionOrigin: "chat_brain_competitor_discovery"');
  assert(i > 0);
  const branch = pilot.slice(Math.max(0, i - 2000), i);
  assert(branch.includes("brainCompetitors("), "known rivals seed the search");
  assert(branch.includes("what_we_do"), "and the saved profile describes the business");
  assert(branch.includes("COMPETITORS_NEED_CONTEXT"),
    "with nothing to start from, it asks rather than guessing");
});
