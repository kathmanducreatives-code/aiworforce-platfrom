// PILOT AND THE CONTENT PAGE PRODUCE THE SAME OBJECT.
//
// ── THE SPLIT THESE TESTS CLOSE ─────────────────────────────────────────────
//
// `writeScribeContent` fills a `content_item` only when the run carries
// `content_loop.content_item_id`. The Content page passed one; NOTHING ELSE
// DID. Pilot handed its raw sentence to orchestrate, orchestrate's engagement
// loop built a `content_loop` with no id, and both landed in `saved_outputs` —
// a table with no status and no version child, which is why the Content page
// renders those rows read-only.
//
// So "Pilot draft" and "Content-page draft" were never two features. They were
// one feature with a missing row, and these tests are what stops the row going
// missing again.
//
// ZERO network, ZERO database, ZERO models. Source text and pure functions.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildContentToolInput, type ContentReference,
} from "../../../supabase/functions/_shared/contentOperations.ts";
import { planCompose } from "../../../supabase/functions/_shared/composeSurface.ts";
import type { RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

const FUNCTIONS = new URL("../../../supabase/functions/", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, FUNCTIONS));

/** Code with comments removed. A name in prose is not a call. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

const REF: ContentReference = {
  content_item_id: "item-1", current_version_id: null, content_type: "linkedin_post",
  status: "draft", title: "T", body: null, current_asset_id: null, brief: "B",
};

/** A minimal compose request. `medium` and references are what vary. */
function composeRequest(i: {
  medium?: "text" | "image";
  entity?: string;
  refs?: Array<{ kind: "named" | "saved_set" | "prior_result"; value: string }>;
}): RequestV1 {
  return {
    version: "request-v1", objective: "compose", confidence: 0.9,
    parts: [{
      id: "p1", objective: "compose",
      subject: { entity: (i.entity ?? "content") as never, references: i.refs ?? [] },
      output: { shape: "artifact", count: null, completeness: "sample", medium: i.medium ?? "text" },
    }],
    ambiguity: [], spend: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  } as unknown as RequestV1;
}

// ══════════ 1. the typed objective, not a keyword ═════════════════════════

Deno.test("1. a fresh content request is `create`", () => {
  const plan = planCompose(composeRequest({ entity: "content" }));
  assertEquals(plan?.kind, "content");
  assertEquals(plan?.content_objective, "create");
  // Nothing was referred back to, so nothing exists to regenerate.
  assertEquals(plan?.targets_existing_content, false);
});

Deno.test("2. a request about a topic, with no back-reference, still creates", () => {
  const plan = planCompose(composeRequest({ entity: "signal" }));
  assertEquals(plan?.content_objective, "create");
});

Deno.test("3. a back-reference makes it a regeneration, not a second draft", () => {
  const plan = planCompose(composeRequest({
    entity: "content", refs: [{ kind: "prior_result", value: "that post" }],
  }));
  assertEquals(plan?.content_objective, "regenerate_text");
  assertEquals(plan?.targets_existing_content, true);
});

Deno.test("4. asking for an image is an image objective, whatever the verb", () => {
  const plan = planCompose(composeRequest({ medium: "image", entity: "content" }));
  assertEquals(plan?.content_objective, "generate_image");
  assertEquals(plan?.medium, "image");
});

Deno.test("5. TEXT IS THE DEFAULT — an absent medium never buys a picture", () => {
  const r = composeRequest({});
  // Delete the field entirely: older payloads and repairs carry none.
  delete (r.parts[0].output as { medium?: unknown }).medium;
  const plan = planCompose(r);
  assertEquals(plan?.medium, "text");
  assert(plan?.content_objective !== "generate_image");
});

Deno.test("6. outreach is untouched — it has no content objective", () => {
  const plan = planCompose(composeRequest({ entity: "person" }));
  assertEquals(plan?.kind, "outreach");
  assertEquals(plan?.content_objective, null);
});

// ══════════ 2. the id is what makes a result canonical ════════════════════

Deno.test("7. the tool input always carries content_item_id", () => {
  const ti = buildContentToolInput({ reference: REF, objective: "create" }) as {
    content_loop: Record<string, unknown>;
  };
  assertEquals(ti.content_loop.content_item_id, "item-1");
});

Deno.test("8. a regeneration is recorded as one, so history stays readable", () => {
  const create = buildContentToolInput({ reference: REF, objective: "create" }) as never as
    { content_loop: { regenerate: boolean } };
  const again = buildContentToolInput({ reference: REF, objective: "regenerate_text" }) as never as
    { content_loop: { regenerate: boolean } };
  assertEquals(create.content_loop.regenerate, false);
  assertEquals(again.content_loop.regenerate, true);
});

Deno.test("9. a signal request carries the real FK, never a title", () => {
  const ti = buildContentToolInput({
    reference: REF, objective: "create", source_signal_id: "sig-42",
  }) as never as { content_loop: { related_signal_ids: string[] } };
  assertEquals(ti.content_loop.related_signal_ids, ["sig-42"]);
});

// ══════════ 3. no shadow path may come back ═══════════════════════════════

Deno.test("10. Pilot does not send its raw sentence as the content instruction", async () => {
  const s = stripComments(await read("pilot-chat/index.ts"));
  const i = s.indexOf('missionOrigin: "chat_brain_compose_content"');
  assert(i > 0, "the content compose branch must still exist");
  // The instruction is the BRIEF STORED ON THE ROW. `instruction: message`
  // is the shadow path: an English sentence, no row, no version, no id.
  const window = s.slice(Math.max(0, i - 1200), i + 200);
  assert(
    !/instruction:\s*message\b/.test(window),
    "the content branch is passing the raw user message again — that is the " +
    "dispatch that produced saved_outputs-only drafts with nothing to open",
  );
});

Deno.test("11. Pilot goes through the canonical content operations", async () => {
  const s = stripComments(await read("pilot-chat/index.ts"));
  assert(s.includes("createCanonicalContentItem"),
    "Pilot must create the canonical row; without it Scribe has no id to fill");
  // THE CALL SITE, not the import. An import that survives while the call is
  // replaced by an inline object is exactly the drift this guards — and a
  // first version of this test passed through precisely that edit.
  assert(/\.\.\.buildContentToolInput\(\{/.test(s),
    "Pilot must CALL buildContentToolInput to build content_loop; assembling " +
    "the object inline is how the id and the regenerate flag drift apart");
  assert(/createCanonicalContentItem\(/.test(s),
    "Pilot must call the canonical creator, not insert a content row itself");
});

Deno.test("12. NO DUPLICATE ARTIFACT: a canonical draft writes no saved_output", async () => {
  const s = stripComments(await read("_shared/memoryWriter.ts"));
  const i = s.indexOf('type: "content_draft"');
  assert(i > 0, "the saved_outputs content write must still exist for id-less runs");
  const before = s.slice(Math.max(0, i - 400), i);
  assert(
    /if\s*\(!cl\?\.content_item_id\s*&&\s*canonicalIds\.length === 0\)/.test(before),
    "the saved_outputs insert must be guarded on there being no content_item_id AND " +
    "no canonical engagement-comment items — " +
    "unguarded, every canonical draft gets a read-only twin and the Content page " +
    "shows the same post twice",
  );
});

Deno.test("13. every content_loop producer supplies an item id", async () => {
  // The engagement loop was the last one that did not.
  const s = stripComments(await read("orchestrate/index.ts"));
  const i = s.indexOf('source: "content_engagement_loop"');
  assert(i > 0, "the engagement loop must still exist");
  const block = s.slice(i, i + 700);
  assert(
    block.includes("content_item_id"),
    "the engagement loop builds a content_loop with no content_item_id — its " +
    "drafts land in saved_outputs and can never be opened, edited or approved",
  );
});

Deno.test("14. the deleted orphans stay deleted", async () => {
  // Each had zero importers: no static import, no lazy import, no route entry,
  // no test. Restoring one needs a caller AND a path through ContentService.
  // The Phase F six dispatched English sentences at Pilot, or rendered
  // `saved_outputs` drafts read-only — both shapes the canonical path replaced.
  for (const p of [
    "ContentPromptBox", "ContentLoopPreview",
    "CommentOpportunityCard", "ContentBrief", "ContentDraftCard",
    "ContentOpportunityCard", "DraftApprovalQueue", "SignalToContentCard",
  ]) {
    const hits: string[] = [];
    for await (const e of Deno.readDir(new URL("../../../src/components/content/", import.meta.url))) {
      if (e.name.startsWith(p)) hits.push(e.name);
    }
    assertEquals(hits, [], `${p} was deleted as an unreachable shadow surface`);
  }
});

Deno.test("15. one instruction builder, not two", async () => {
  // Pilot builds content server-side, so the edge runtime needs the brief too.
  // A copy would drift, and a regeneration reads the brief back off the row —
  // so a drifted copy means the second draft answers a different question.
  const shared = await read("_shared/contentInstruction.ts");
  assert(shared.includes("export function buildContentInstruction"),
    "the canonical builder lives in _shared, where both runtimes can reach it");
  const mirror = await Deno.readTextFile(
    new URL("../../../src/lib/content/contentInstruction.ts", import.meta.url));
  assert(
    !/function\s+buildContentInstruction/.test(stripComments(mirror)),
    "src/ must RE-EXPORT the builder, never re-implement it",
  );
});

// ══════════ 4. content never becomes a lead ═══════════════════════════════

Deno.test("16. a Content run still takes no lead lineage", async () => {
  const s = stripComments(await read("run-agent/index.ts"));
  assert(s.includes("runNeedsLineageLease"),
    "the lease must stay conditional — a Content run has no continuation to " +
    "fence and leaves a lineage nothing ever closes");
});


// ══════════ 4. a signal handed to Pilot ══════════════════════════════════════

Deno.test("17. a signal is not something you can write outreach TO", () => {
  // "Turn this signal into a LinkedIn post" refers back to a signal. Under the
  // old rule — any back-reference means leads — this was outreach, and Pilot
  // answered a content request with "I don't have any leads saved to write to
  // yet." A signal cannot receive a message, so it is never outreach.
  const plan = planCompose(composeRequest({
    entity: "signal", refs: [{ kind: "prior_result", value: "this signal" }],
  }));
  assertEquals(plan?.kind, "content");
  // And it CREATES. The thing referred back to is a signal, not a draft, so
  // there is nothing to regenerate.
  assertEquals(plan?.content_objective, "create");
  assertEquals(plan?.targets_existing_content, false);
});

Deno.test("18. a held company pointed back at is still outreach, still gated", () => {
  // The guard on the guard: narrowing outreach must not un-gate it. A company
  // we hold is written to through its people.
  const plan = planCompose(composeRequest({
    entity: "company", refs: [{ kind: "prior_result", value: "the top 5" }],
  }));
  assertEquals(plan?.kind, "outreach");
  assertEquals(plan?.content_objective, null);
});

Deno.test("18b. a company merely NAMED is a topic, not a recipient", () => {
  // The checkpoint's first cut made every `company` subject outreach, so
  // "write a LinkedIn post about Stripe" went to Penn's send-approval path.
  const plan = planCompose(composeRequest({
    entity: "company", refs: [{ kind: "named", value: "Stripe" }],
  }));
  assertEquals(plan?.kind, "content");
  assertEquals(plan?.content_objective, "create");
});

Deno.test("18c. a person and a saved set of leads are still outreach", () => {
  assertEquals(planCompose(composeRequest({ entity: "person" }))?.kind, "outreach");
  assertEquals(planCompose(composeRequest({
    entity: "content", refs: [{ kind: "saved_set", value: "my leads" }],
  }))?.kind, "outreach");
});

Deno.test("19. the signal id is verified in the shared module, scoped by workspace, before routing", async () => {
  const mod = stripComments(await read("_shared/signalContentHandoff.ts"));
  for (const table of ['from("signal_events")', 'from("signals")']) {
    const i = mod.indexOf(table);
    assert(i > 0, `the handoff must look ${table} up rather than trusting the body`);
  }
  // Every lookup is workspace-scoped: the id arrives from the browser and this
  // path holds the service role.
  const lookups = mod.split(".maybeSingle()").length - 1;
  const scoped = mod.split('eq("workspace_id", workspaceId)').length - 1;
  assertEquals(scoped, lookups, "every signal lookup must be scoped to the workspace");
  // `signal_events` has no `title` column. The checkpoint selected one, which
  // made every lookup fail and every signal draft silently an idea.
  assert(!/from\("signal_events"\)\s*\.select\("[^"]*\btitle\b/.test(mod),
    "signal_events has no title column — read normalized_value.title");

  const s = stripComments(await read("pilot-chat/index.ts"));
  const verify = s.indexOf("resolveSignalHandoff(");
  const anchor = s.indexOf("anchorComposeToSignal(");
  const referents = s.indexOf("resolveReferents(understood.request");
  const route = s.indexOf("brainRoute = routeRequest(");
  assert(verify > 0 && anchor > verify, "verify, then anchor");
  assert(anchor < referents && anchor < route,
    "the request must be anchored before lead referents and the router read it");
  // The id comes from the client's metadata — never a model `resolved_key`.
  assert(s.includes("resolveSignalHandoff(\n          admin as unknown as SignalLookupDb, workspaceId, actionMetadata?.signal_id)"),
    "the claimed id is body.metadata.signal_id");
  // No second, unverified reading of the id anywhere in Pilot.
  assertEquals(s.split("actionMetadata?.signal_id").length - 1, 1,
    "Pilot reads the client's signal id in exactly one place, the verified one");
});

Deno.test("20. the canonical draft carries the VERIFIED signal, not a claimed one", async () => {
  const s = stripComments(await read("pilot-chat/index.ts"));
  const create = s.indexOf("createCanonicalContentItem(contentDb");
  assert(create > 0);
  const block = s.slice(create - 900, create + 1200);
  assert(block.includes('signalHandoff.kind === "signal" ? signalHandoff.signal_id : null'),
    "only a canonical, verified signal becomes source_signal_id");
  assert(block.includes('source_type: signalId ? "signal" : "idea"'));
  assert(block.includes("source_signal_id: signalId"));
  // And the same id reaches Scribe's typed tool input.
  assert(s.includes("source_signal_id: createdSignalId"));
  // A handoff always creates: the objective is decided with the handoff.
  assert(s.includes("contentObjectiveForHandoff(plan.content_objective, signalHandoff)"));
});

Deno.test("21. a refused signal stops before any draft or model call", async () => {
  const s = stripComments(await read("pilot-chat/index.ts"));
  const refused = s.indexOf('signalHandoff.kind === "refused"');
  assert(refused > 0);
  const route = s.indexOf("brainRoute = routeRequest(");
  const create = s.indexOf("createCanonicalContentItem(contentDb");
  assert(refused < route && refused < create,
    "an unverified signal must be refused before routing, row creation or delegation");
  assert(s.slice(refused, refused + 500).includes("return await replyAndReturn("),
    "the refusal returns — it does not fall through to an idea draft");
});
