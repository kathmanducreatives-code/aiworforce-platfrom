// THE CALL THAT WAS MISSING.
//
// ── CONTENT P0-2, FROM THE FRONT ────────────────────────────────────────────
//
// The whole generation path already existed: `run-agent` creates a task when
// none is supplied, executes the agent, and hands `scribe` results to
// `writeScribeContent`. Production had 106 `scout` tasks, 1 `aria`, and zero
// `scribe` — nothing in the product had ever asked for one.
//
// Content's twelve actions all called `sendAgentCommand(<English sentence>)`,
// which posts a window event that the chat composer picks up. That reaches
// `pilot-chat`, which is a conversation, not a content generator, so the
// sentence "Scribe, draft a LinkedIn post…" produced prose in a chat bubble
// and no draft anywhere.
//
// These pin the properties that make the new path real rather than another
// sentence: it names the agent that writes content, it names the draft it is
// filling, and the user asks for it deliberately.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

const GEN = await read("src/lib/content/generateContentDraft.ts");
const PAGE = await read("src/pages/Content.tsx");
const DRAWER = await read("src/components/content/ContentStudioEditor.tsx");
const CREATE_MODAL = await read("src/components/content/CreatePostModal.tsx");

// ══════════ 1. it asks the right agent, for the right draft ═══════════════

Deno.test("THE MISSING CALL: generation invokes run-agent as scribe", () => {
  assert(
    /functions\.invoke\('run-agent'/.test(GEN),
    "generation must reach run-agent, which is what creates the task",
  );
  assert(
    /agent_slug: 'scribe'/.test(GEN),
    "content is written by scribe. `penn` is the outreach writer and persists " +
      "outreach_drafts, so addressing it would put content in the wrong object model.",
  );
});

Deno.test("THE 400 THIS ACTUALLY RETURNED: the orchestrated contract is satisfied", () => {
  // Found by running it. run-agent has two entry modes. The DIRECT mode carries
  // no plan_id/step_index but is lead-specific (`isDirectLeadActionAttempt`) and
  // is now a tombstone — workbench lead actions answer 410. Everything else hits
  // the orchestrated gate:
  //
  //   !plan_id || step_index === undefined || (!agent_slug && !agent_id) ||
  //   !workspace_id || !instruction   ->   400 missing_required_fields
  //
  // The first attempt sent none of the plan fields and got exactly that, with a
  // spinner and no draft. A one-step plan is created instead of faked, because a
  // content generation genuinely is one step by a known agent.
  assert(
    /\.from\('task_plans'\)/.test(GEN),
    "generation must create the plan run-agent's contract requires",
  );
  for (const field of ["plan_id:", "step_index: 0", "workspace_id:", "instruction:"]) {
    assert(GEN.includes(field), `the run-agent body must carry ${field}`);
  }
  // And must not proceed to spend if the plan could not be created.
  const planAt = GEN.indexOf(".from('task_plans')");
  const guardAt = GEN.indexOf("plan_create_failed");
  const invokeAt = GEN.indexOf("functions.invoke('run-agent'");
  assert(planAt < guardAt && guardAt < invokeAt,
    "a failed plan insert must return before invoking the model");
});

Deno.test("it names the draft it is filling in", () => {
  // Without `content_item_id` the writer falls back to saved_outputs only, and
  // the user's draft stays empty while a row appears somewhere they cannot see.
  assert(
    /content_item_id: args\.contentItemId/.test(GEN),
    "the request must carry the content_item being filled",
  );
  assert(
    /content_loop: \{/.test(GEN),
    "it must travel in `content_loop`, which run-agent already forwards to the writer",
  );
});

Deno.test("a 200 with success:false is not a finished draft", () => {
  // run-agent answers 200 and `success: false` for refusals — an unidentified
  // user, a spend ceiling, a provider failure. Reading only the transport error
  // would show a spinner resolving into an unchanged, empty draft.
  assert(
    /res\.success === false \|\| res\.error/.test(GEN),
    "a refusal returned as 200 must be treated as a failure",
  );
});

Deno.test("the client does not write the generated body itself", () => {
  // `writeScribeContent` writes the row server-side. A client that also wrote
  // it would be a second writer that can disagree with the row, and the drawer
  // would show whichever won.
  assert(
    !/\.from\('content_item'\)|updateContentItem/.test(GEN),
    "generation must not write the body from the client — it re-reads the row",
  );
});

// ══════════ 2. the user asks, and pays, deliberately ══════════════════════

Deno.test("generation is explicit, never automatic on create", () => {
  // Generating whenever the create modal is used would spend a model call on
  // every stray click. Creating a draft is free; asking Scribe is not.
  assert(
    !/generateContentDraft/.test(CREATE_MODAL),
    "CreatePostModal must not generate — creating a draft must stay free",
  );
  assert(
    /onWriteText/.test(DRAWER),
    "the Studio must expose an explicit write control — Scribe is asked, never assumed",
  );
  assert(
    /generateContentDraft\(/.test(PAGE),
    "the page must wire a real generator, or the control is decorative",
  );
});

// ══════════ 3. the result is actually shown ═══════════════════════════════

Deno.test("THE BUG THAT WOULD LOOK LIKE NOTHING HAPPENED", () => {
  // Scribe writes the row server-side, so the draft's id does not change —
  // only its body does. The editor seeds from `detail.body` keyed on
  // `detail?.id`, so without a second effect the textarea keeps showing the
  // empty draft and "Draft with Scribe" appears to do nothing at all.
  assert(
    /\}, \[item\.body\]\);/.test(DRAWER),
    "the editor must react to the body changing under the same draft",
  );
  // ...and must not do it by clobbering unsaved typing.
  assert(
    /setDraftBody\(\(current\) => \(current === seeded\.current \? incoming : current\)\)/.test(DRAWER),
    "adopting a server-side change must not overwrite unsaved local edits",
  );
  assert(
    /reloadContentDrafts\(\)/.test(PAGE),
    "the page must re-read the row after generation — the server is the writer",
  );
});

Deno.test("the generate control reports failure instead of silently resolving", () => {
  assert(/setError\(err instanceof Error \? err\.message/.test(DRAWER), "a failed generation must surface an error");
  assert(
    /if \(!res\.ok\) throw new Error/.test(PAGE),
    "the page must propagate a refusal to the control that asked for it",
  );
});
